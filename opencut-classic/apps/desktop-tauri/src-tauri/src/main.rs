// Don't open a console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, File};
use std::io::ErrorKind;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

// Fixed local port — this is a single-instance local app, no need to pick a
// free port dynamically. Chosen away from common dev-server defaults
// (3000/8080/etc) to avoid colliding with something else the user has open.
const PORT: u16 = 47821;

struct ServerProcess(Mutex<Option<Child>>);

#[cfg(windows)]
const NODE_BIN: &str = "node.exe";
#[cfg(not(windows))]
const NODE_BIN: &str = "node";

fn main() {
	tauri::Builder::default()
		.manage(ServerProcess(Mutex::new(None)))
		.setup(|app| {
			let resource_dir = app
				.path()
				.resource_dir()
				.expect("resource dir should be resolvable");
			let data_dir = app
				.path()
				.app_data_dir()
				.expect("app data dir should be resolvable");
			let log_dir = data_dir.join("logs");
			fs::create_dir_all(&log_dir).ok();

			// resource_dir() is the bundle's resources root; "node"/"server"
			// here are destinations declared in tauri.conf.json's
			// bundle.resources, relative to that same root.
			let node_bin = resource_dir.join("node").join(NODE_BIN);
			let server_entry = resource_dir.join("server").join("server.js");
			let db_path = data_dir.join("data").join("opencut.db");

			match spawn_server(&node_bin, &server_entry, &db_path, &log_dir) {
				Ok(child) => {
					app.state::<ServerProcess>().0.lock().unwrap().replace(child);
				}
				Err(err) => {
					fail_visibly(
						&log_dir,
						&format!(
							"Failed to start the local server.\n\nnode: {}\nserver: {}\n\nerror: {err}",
							node_bin.display(),
							server_entry.display(),
						),
					);
				}
			}

			if let Err(err) = wait_for_server(PORT, Duration::from_secs(30)) {
				fail_visibly(
					&log_dir,
					&format!(
						"The local server didn't respond on 127.0.0.1:{PORT} within 30s.\n\n\
						error: {err}\n\nCheck logs\\server.stderr.log in this app's data folder for why."
					),
				);
			}

			let url = format!("http://127.0.0.1:{PORT}").parse().unwrap();
			WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
				.title("OpenCut")
				.inner_size(1440.0, 900.0)
				.min_inner_size(960.0, 600.0)
				.build()?;

			Ok(())
		})
		.on_window_event(|window, event| {
			// Only one window in this app — treat it closing as "quit", and
			// make sure the Node child doesn't outlive it.
			if let tauri::WindowEvent::Destroyed = event {
				let state = window.state::<ServerProcess>();
				let child = state.0.lock().unwrap().take();
				if let Some(mut child) = child {
					let _ = child.kill();
				}
			}
		})
		.run(tauri::generate_context!())
		.expect("error while running the OpenCut desktop shell");
}

/// Writes `message` to logs\fatal.log, shows it in a native message box, and
/// exits. Startup failures here happen before any window exists — panicking
/// (the old behavior) is invisible in a windows_subsystem="windows" release
/// build, so this is the only way the user ever finds out something broke.
fn fail_visibly(log_dir: &Path, message: &str) -> ! {
	let _ = fs::write(log_dir.join("fatal.log"), message);
	#[cfg(windows)]
	show_message_box("OpenCut failed to start", message);
	#[cfg(not(windows))]
	eprintln!("OpenCut failed to start: {message}");
	std::process::exit(1);
}

#[cfg(windows)]
fn show_message_box(title: &str, message: &str) {
	use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

	let title_w: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
	let message_w: Vec<u16> = message.encode_utf16().chain(std::iter::once(0)).collect();
	unsafe {
		MessageBoxW(
			std::ptr::null_mut(),
			message_w.as_ptr(),
			title_w.as_ptr(),
			MB_OK | MB_ICONERROR,
		);
	}
}

fn spawn_server(
	node_bin: &PathBuf,
	server_entry: &PathBuf,
	db_path: &PathBuf,
	log_dir: &Path,
) -> std::io::Result<Child> {
	if !node_bin.exists() {
		return Err(std::io::Error::new(
			ErrorKind::NotFound,
			format!("bundled node binary not found at {}", node_bin.display()),
		));
	}
	if !server_entry.exists() {
		return Err(std::io::Error::new(
			ErrorKind::NotFound,
			format!("bundled server.js not found at {}", server_entry.display()),
		));
	}

	let stdout_log = File::create(log_dir.join("server.stdout.log"))?;
	let stderr_log = File::create(log_dir.join("server.stderr.log"))?;

	let mut cmd = Command::new(node_bin);
	// Windows shortcuts (Start Menu, taskbar pins) often launch a GUI app
	// with no sane working directory set — sometimes the drive root. Node's
	// module resolution walks up from cwd looking for package.json/
	// node_modules and can hit `realpathSync("C:")` on the way, which
	// throws EISDIR (a known Node/Windows quirk: "C:" without a trailing
	// backslash isn't a valid path to stat, only "C:\" is). Anchoring cwd
	// to the server's own directory sidesteps this entirely regardless of
	// whatever cwd the shortcut handed us.
	if let Some(server_dir) = server_entry.parent() {
		cmd.current_dir(server_dir);
	}
	cmd.arg(server_entry)
		.env("NODE_ENV", "production")
		.env("PORT", PORT.to_string())
		.env("HOSTNAME", "127.0.0.1")
		.env("DATABASE_URL", db_path.to_string_lossy().to_string())
		.env("NEXT_PUBLIC_SITE_URL", format!("http://127.0.0.1:{PORT}"))
		.stdout(Stdio::from(stdout_log))
		.stderr(Stdio::from(stderr_log));

	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		const CREATE_NO_WINDOW: u32 = 0x0800_0000;
		cmd.creation_flags(CREATE_NO_WINDOW);
	}

	cmd.spawn()
}

fn wait_for_server(port: u16, timeout: Duration) -> std::io::Result<()> {
	let deadline = std::time::Instant::now() + timeout;
	loop {
		match TcpStream::connect(("127.0.0.1", port)) {
			Ok(_) => return Ok(()),
			Err(err) if err.kind() == ErrorKind::ConnectionRefused => {}
			Err(err) if std::time::Instant::now() >= deadline => return Err(err),
			Err(_) => {}
		}
		if std::time::Instant::now() >= deadline {
			return Err(std::io::Error::new(
				ErrorKind::TimedOut,
				"server did not start in time",
			));
		}
		std::thread::sleep(Duration::from_millis(200));
	}
}
