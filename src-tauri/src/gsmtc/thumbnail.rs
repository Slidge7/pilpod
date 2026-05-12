use base64::{engine::general_purpose::STANDARD, Engine};
use windows::{
    core::HSTRING,
    Storage::Streams::{DataReader, IRandomAccessStreamWithContentType},
};

const MAX_THUMBNAIL_BYTES: u64 = 512 * 1024;

pub fn read_thumbnail_b64(
    stream: &IRandomAccessStreamWithContentType,
) -> windows::core::Result<(String, Option<String>)> {
    let size = stream.Size()?;
    if size == 0 || size > MAX_THUMBNAIL_BYTES {
        return Ok((String::new(), None));
    }
    let count = size as u32;
    let reader = DataReader::CreateDataReader(stream)?;
    reader.LoadAsync(count)?.get()?;
    let mut buf = vec![0u8; count as usize];
    reader.ReadBytes(&mut buf)?;
    let mime = stream.ContentType().ok().map(|ct: HSTRING| ct.to_string());
    if mime.as_deref() == Some("") {
        return Ok((STANDARD.encode(&buf), None));
    }
    Ok((STANDARD.encode(&buf), mime))
}
