//! Peer-PID browser verification — the Phase 3 ground truth.
//!
//! When an extension connects to the loopback bridge we know the peer's
//! ephemeral port. `GetExtendedTcpTable` maps that port to the owning process,
//! whose exe path identifies the browser via the catalog — no UA guessing.
//! This distinguishes Brave/Vivaldi/Arc/Opera GX from Chrome even though they
//! all self-report as "Chrome" in MV3 service workers.
//!
//! Chromium runs its network stack in a utility child process, but that child
//! is the same executable (`chrome.exe`, `brave.exe`, …), so the exe match
//! still identifies the right browser. Same for Firefox's socket process.

use std::net::SocketAddr;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

/// A row from the OS TCP connection table (already byte-order normalised).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TcpRow {
    pub local_port: u16,
    pub remote_port: u16,
    pub owning_pid: u32,
}

/// Pick the PID owning the client side of a loopback connection.
///
/// From the server's perspective the peer's port is the client's *local*
/// port, and the client's *remote* port is the server's listening port.
/// Pure logic — unit tested with synthetic tables.
pub fn find_peer_pid(rows: &[TcpRow], peer_port: u16, server_port: u16) -> Option<u32> {
    rows.iter()
        .find(|r| r.local_port == peer_port && r.remote_port == server_port)
        .map(|r| r.owning_pid)
}

/// Resolve the catalog browser id for a loopback peer, or `None` when the
/// owning process is not a catalog browser (or the lookup failed).
pub fn verified_os_id_for_peer(peer: SocketAddr, server_port: u16) -> Option<String> {
    if !peer.ip().is_loopback() {
        return None;
    }
    let rows = read_tcp_table(peer.is_ipv6());
    let pid = find_peer_pid(&rows, peer.port(), server_port)?;
    os_id_for_pid(pid)
}

/// Cached variant for the HTTP path (heartbeats arrive every second; the
/// peer port is stable per keep-alive connection). 60 s TTL per peer port.
pub fn cached_verified_os_id_for_peer(peer: SocketAddr, server_port: u16) -> Option<String> {
    const TTL: Duration = Duration::from_secs(60);
    static CACHE: LazyLock<Mutex<std::collections::HashMap<u16, (Instant, Option<String>)>>> =
        LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

    let now = Instant::now();
    if let Ok(cache) = CACHE.lock() {
        if let Some((at, cached)) = cache.get(&peer.port()) {
            if now.duration_since(*at) < TTL {
                return cached.clone();
            }
        }
    }

    let fresh = verified_os_id_for_peer(peer, server_port);
    if let Ok(mut cache) = CACHE.lock() {
        // Opportunistic sweep so dead ephemeral ports don't accumulate.
        if cache.len() > 256 {
            cache.retain(|_, (at, _)| now.duration_since(*at) < TTL);
        }
        cache.insert(peer.port(), (now, fresh.clone()));
    }
    fresh
}

/// Map a PID to a catalog browser id via its executable path.
fn os_id_for_pid(pid: u32) -> Option<String> {
    let full_path = unsafe { crate::browser_catalog::image_path_for_pid(pid) }?;
    let exe_name = std::path::Path::new(&full_path)
        .file_name()?
        .to_string_lossy()
        .to_string();
    crate::browser_catalog::match_running_process(&exe_name, Some(&full_path))
        .map(|id| id.to_string())
}

// ── OS table read (Windows) ──────────────────────────────────────────────────

#[cfg(windows)]
fn read_tcp_table(ipv6: bool) -> Vec<TcpRow> {
    use windows::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, TCP_TABLE_OWNER_PID_CONNECTIONS,
    };
    use windows::Win32::Networking::WinSock::{AF_INET, AF_INET6};

    let family = if ipv6 { AF_INET6.0 as u32 } else { AF_INET.0 as u32 };

    // First call sizes the buffer; retry loop guards against races.
    let mut size: u32 = 0;
    unsafe {
        let _ = GetExtendedTcpTable(
            None,
            &mut size,
            false,
            family,
            TCP_TABLE_OWNER_PID_CONNECTIONS,
            0,
        );
    }

    for _ in 0..3 {
        // u32 buffer: the table structs are 4-byte aligned; Vec<u8> is not.
        let words = ((size.max(16) as usize) + 3) / 4;
        let mut buf = vec![0u32; words];
        let rc = unsafe {
            GetExtendedTcpTable(
                Some(buf.as_mut_ptr() as *mut core::ffi::c_void),
                &mut size,
                false,
                family,
                TCP_TABLE_OWNER_PID_CONNECTIONS,
                0,
            )
        };
        if rc == 0 {
            if buf.is_empty() {
                return Vec::new();
            }
            return if ipv6 { parse_v6(&buf) } else { parse_v4(&buf) };
        }
        // ERROR_INSUFFICIENT_BUFFER — size was updated, retry.
    }
    Vec::new()
}

/// Safety: `buf` must hold a complete `MIB_TCPTABLE_OWNER_PID` as returned by
/// a successful `GetExtendedTcpTable` call (guaranteed by the caller above).
#[cfg(windows)]
fn parse_v4(buf: &[u32]) -> Vec<TcpRow> {
    use windows::Win32::NetworkManagement::IpHelper::{
        MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID,
    };
    unsafe {
        let table = &*(buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
        let count = table.dwNumEntries as usize;
        let first: *const MIB_TCPROW_OWNER_PID = table.table.as_ptr();
        let mut rows = Vec::with_capacity(count);
        for i in 0..count {
            let r = &*first.add(i);
            rows.push(TcpRow {
                local_port: u16::from_be((r.dwLocalPort & 0xFFFF) as u16),
                remote_port: u16::from_be((r.dwRemotePort & 0xFFFF) as u16),
                owning_pid: r.dwOwningPid,
            });
        }
        rows
    }
}

/// Safety: `buf` must hold a complete `MIB_TCP6TABLE_OWNER_PID` as returned by
/// a successful `GetExtendedTcpTable` call (guaranteed by the caller above).
#[cfg(windows)]
fn parse_v6(buf: &[u32]) -> Vec<TcpRow> {
    use windows::Win32::NetworkManagement::IpHelper::{
        MIB_TCP6ROW_OWNER_PID, MIB_TCP6TABLE_OWNER_PID,
    };
    unsafe {
        let table = &*(buf.as_ptr() as *const MIB_TCP6TABLE_OWNER_PID);
        let count = table.dwNumEntries as usize;
        let first: *const MIB_TCP6ROW_OWNER_PID = table.table.as_ptr();
        let mut rows = Vec::with_capacity(count);
        for i in 0..count {
            let r = &*first.add(i);
            rows.push(TcpRow {
                local_port: u16::from_be((r.dwLocalPort & 0xFFFF) as u16),
                remote_port: u16::from_be((r.dwRemotePort & 0xFFFF) as u16),
                owning_pid: r.dwOwningPid,
            });
        }
        rows
    }
}

#[cfg(not(windows))]
fn read_tcp_table(_ipv6: bool) -> Vec<TcpRow> {
    Vec::new()
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn row(local: u16, remote: u16, pid: u32) -> TcpRow {
        TcpRow {
            local_port: local,
            remote_port: remote,
            owning_pid: pid,
        }
    }

    #[test]
    fn finds_matching_connection() {
        let rows = vec![
            row(50000, 443, 111),
            row(51234, 17872, 4242), // extension → bridge
            row(51234, 443, 999),    // same local port, different remote (unlikely but possible)
        ];
        assert_eq!(find_peer_pid(&rows, 51234, 17872), Some(4242));
    }

    #[test]
    fn requires_both_ports_to_match() {
        let rows = vec![row(51234, 443, 999)];
        assert_eq!(find_peer_pid(&rows, 51234, 17872), None);
        assert_eq!(find_peer_pid(&rows, 50000, 443), None);
    }

    #[test]
    fn empty_table_yields_none() {
        assert_eq!(find_peer_pid(&[], 51234, 17872), None);
    }

    #[test]
    fn non_loopback_peer_is_rejected() {
        let peer: SocketAddr = "192.168.1.50:51234".parse().unwrap();
        assert_eq!(verified_os_id_for_peer(peer, 17872), None);
    }
}
