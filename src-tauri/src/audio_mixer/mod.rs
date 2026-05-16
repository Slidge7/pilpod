//! Default render endpoint WASAPI session enumeration (per-app volume).

use windows::core::Interface;
use windows::Win32::{
    Foundation::{CloseHandle, RPC_E_CHANGED_MODE, S_FALSE, S_OK},
    Media::Audio::{
        eConsole, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
        ISimpleAudioVolume, MMDeviceEnumerator,
    },
    System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED},
    System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    },
};

#[derive(Debug, Clone)]
pub(crate) struct MixerSessionRow {
    pub instance_id: String,
    pub process_id: u32,
    pub display_name: String,
    pub volume: f32,
    pub muted: bool,
    pub image_path: Option<String>,
}

fn ensure_com_multithreaded() -> Result<(), String> {
    unsafe {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        if hr.is_ok() || hr == RPC_E_CHANGED_MODE || hr == S_FALSE {
            Ok(())
        } else {
            Err(format!("CoInitializeEx failed: {:?}", hr))
        }
    }
}

unsafe fn wide_nt_to_string(ptr: *mut u16) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    while *ptr.add(len) != 0 {
        len += 1;
        if len > 4096 {
            break;
        }
    }
    let slice = std::slice::from_raw_parts(ptr, len);
    String::from_utf16_lossy(slice).to_string()
}

unsafe fn take_co_task_pwstr(pwstr: windows::core::PWSTR) -> String {
    let ptr = pwstr.as_ptr();
    let s = wide_nt_to_string(ptr);
    if !ptr.is_null() {
        CoTaskMemFree(Some(ptr as *const _));
    }
    s
}

unsafe fn image_path_for_pid(pid: u32) -> Option<String> {
    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
    let mut buf = vec![0u16; 2048];
    let mut size = buf.len() as u32;
    let r = QueryFullProcessImageNameW(
        handle,
        PROCESS_NAME_WIN32,
        windows::core::PWSTR(buf.as_mut_ptr()),
        &mut size,
    );
    let _ = CloseHandle(handle);
    r.ok()?;
    let len = size as usize;
    Some(String::from_utf16_lossy(&buf[..len]).to_string())
}

/// Enumerate active audio sessions on the default playback device.
pub fn enumerate_sessions() -> Result<Vec<MixerSessionRow>, String> {
    unsafe {
        ensure_com_multithreaded()?;
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| e.to_string())?;
        let mgr: IAudioSessionManager2 = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| e.to_string())?;
        let list = mgr.GetSessionEnumerator().map_err(|e| e.to_string())?;
        let n = list.GetCount().map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for i in 0..n {
            let ctrl = match list.GetSession(i) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let ctrl2: IAudioSessionControl2 = match ctrl.cast() {
                Ok(c) => c,
                Err(_) => continue,
            };
            // S_OK = is system sounds (skip), S_FALSE = not system sounds (keep)
            if ctrl2.IsSystemSoundsSession() == S_OK {
                continue;
            }
            let pid = match ctrl2.GetProcessId() {
                Ok(p) => p,
                Err(_) => continue,
            };
            if pid == 0 {
                continue;
            }
            let instance_raw = match ctrl2.GetSessionInstanceIdentifier() {
                Ok(p) => p,
                Err(_) => continue,
            };
            let instance_id = take_co_task_pwstr(instance_raw);
            if instance_id.is_empty() {
                continue;
            }
            let display_name = match ctrl.GetDisplayName() {
                Ok(p) => take_co_task_pwstr(p),
                Err(_) => String::new(),
            };
            let vol: ISimpleAudioVolume = match ctrl.cast() {
                Ok(v) => v,
                Err(_) => continue,
            };
            let volume = vol.GetMasterVolume().unwrap_or(1.0).clamp(0.0, 1.0);
            let muted = vol.GetMute().map(|m| m.as_bool()).unwrap_or(false);
            let image_path = image_path_for_pid(pid);
            out.push(MixerSessionRow {
                instance_id,
                process_id: pid,
                display_name,
                volume,
                muted,
                image_path,
            });
        }
        Ok(out)
    }
}

pub(crate) fn set_session_volume_by_instance_id(
    instance_id: &str,
    level: f32,
) -> Result<(), String> {
    let level = level.clamp(0.0, 1.0);
    unsafe {
        ensure_com_multithreaded()?;
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| e.to_string())?;
        let mgr: IAudioSessionManager2 = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| e.to_string())?;
        let list = mgr.GetSessionEnumerator().map_err(|e| e.to_string())?;
        let n = list.GetCount().map_err(|e| e.to_string())?;
        for i in 0..n {
            let ctrl = match list.GetSession(i) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let ctrl2: IAudioSessionControl2 = match ctrl.cast() {
                Ok(c) => c,
                Err(_) => continue,
            };
            let raw = match ctrl2.GetSessionInstanceIdentifier() {
                Ok(p) => p,
                Err(_) => continue,
            };
            let id = take_co_task_pwstr(raw);
            if id != instance_id {
                continue;
            }
            let vol: ISimpleAudioVolume = ctrl.cast().map_err(|e| e.to_string())?;
            vol.SetMasterVolume(level, std::ptr::null())
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err("Audio session not found".into())
}
