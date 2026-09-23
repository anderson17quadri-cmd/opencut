// Don't open a console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::ErrorKind;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
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
			std::fs::create_dir_all(&data_dir).ok();

			let node_bin = resource_dir.join("resources/node").join(NODE_BIN);
			let server_entry = resource_dir
				.join("resources/server")
				.join("server.js");
			let db_path = data_dir.join("data").join("opencut.db");

			let child = spawn_server(&node_bin, &server_entry, &db_path)
				.expect("failed to start the local OpenCut server");
			app.state::<ServerProcess>().0.lock().unwrap().replace(child);

			wait_for_server(PORT, Duration::from_secs(30))
				.expect("local server did not come up in time");

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

fn spawn_server(
	node_bin: &PathBuf,
	server_entry: &PathBuf,
	db_path: &PathBuf,
) -> std::io::Result<Child> {
	let mut cmd = Command::new(node_bin);
	cmd.arg(server_entry)
		.env("NODE_ENV", "production")
		.env("PORT", PORT.to_string())
		.env("HOSTNAME", "127.0.0.1")
		.env("DATABASE_URL", db_path.to_string_lossy().to_string())
		.env("NEXT_PUBLIC_SITE_URL", format!("http://127.0.0.1:{PORT}"));

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
