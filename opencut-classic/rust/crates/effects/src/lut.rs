use std::cell::{Cell, RefCell};
use std::collections::HashMap;

// 3D colour lookup tables (film looks, .cube LUTs) registered from
// JavaScript once and referenced by id from the "lut" effect pass, so the
// table isn't sent again for every frame. Each effect pipeline turns them
// into GPU textures on first use.

pub(crate) struct LutData {
    pub size: u32,
    pub rgba: Vec<u8>,
    pub version: u64,
}

thread_local! {
    static LUTS: RefCell<HashMap<u32, LutData>> = RefCell::new(HashMap::new());
    static NEXT_VERSION: Cell<u64> = const { Cell::new(1) };
}

/// Stores (or replaces) a LUT: `size`³ RGBA8 texels, red varying fastest,
/// then green, then blue (the .cube order).
pub fn register_lut(id: u32, size: u32, rgba: Vec<u8>) -> Result<(), String> {
    if !(2..=65).contains(&size) {
        return Err(format!("LUT size must be 2..65, got {size}"));
    }
    let expected = (size * size * size * 4) as usize;
    if rgba.len() != expected {
        return Err(format!("LUT of size {size} needs {expected} bytes, got {}", rgba.len()));
    }
    let version = NEXT_VERSION.with(|next| {
        let version = next.get();
        next.set(version + 1);
        version
    });
    LUTS.with(|luts| {
        luts.borrow_mut().insert(id, LutData { size, rgba, version });
    });
    Ok(())
}

pub(crate) fn lut_version(id: u32) -> Option<u64> {
    LUTS.with(|luts| luts.borrow().get(&id).map(|lut| lut.version))
}

pub(crate) fn with_lut<R>(id: u32, read: impl FnOnce(&LutData) -> R) -> Option<R> {
    LUTS.with(|luts| luts.borrow().get(&id).map(read))
}
