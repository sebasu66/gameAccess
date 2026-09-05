use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DownloadJobRecord {
    pub app_id: u32,
    pub job_id: String,
    pub requested_at_ms: u64,
    pub completed_at_ms: Option<u64>,
    pub acknowledged: bool,
    pub cancelled: bool,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn store_path() -> PathBuf {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir)
        .join("gameAccess")
        .join("download-jobs.json")
}

fn load() -> Result<Vec<DownloadJobRecord>, String> {
    let path = store_path();
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let body = fs::read(&path).map_err(|err| format!("Could not read download lifecycle store: {err}"))?;
    serde_json::from_slice(&body).map_err(|err| format!("Download lifecycle store is invalid: {err}"))
}

fn save(records: &[DownloadJobRecord]) -> Result<(), String> {
    let path = store_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("Could not create download lifecycle directory: {err}"))?;
    }
    let body = serde_json::to_vec(records).map_err(|err| format!("Could not encode download lifecycle store: {err}"))?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, body).map_err(|err| format!("Could not write download lifecycle store: {err}"))?;
    fs::rename(temp, path).map_err(|err| format!("Could not publish download lifecycle store: {err}"))
}

pub fn register_download_job(app_id: u32, requested_job_id: String) -> Result<DownloadJobRecord, String> {
    if app_id == 0 || requested_job_id.trim().is_empty() {
        return Err("Invalid download job identity".into());
    }
    let mut records = load()?;
    if let Some(existing) = records.iter().rev().find(|record| {
        record.app_id == app_id && !record.acknowledged && !record.cancelled && record.completed_at_ms.is_none()
    }) {
        return Ok(existing.clone());
    }
    if let Some(existing) = records.iter().find(|record| record.job_id == requested_job_id) {
        return Ok(existing.clone());
    }
    let record = DownloadJobRecord {
        app_id,
        job_id: requested_job_id,
        requested_at_ms: now_ms(),
        completed_at_ms: None,
        acknowledged: false,
        cancelled: false,
    };
    records.push(record.clone());
    if records.len() > 256 {
        let drop_count = records.len() - 256;
        records.drain(0..drop_count);
    }
    save(&records)?;
    Ok(record)
}

pub fn complete_latest_for_app(app_id: u32) -> Result<Option<DownloadJobRecord>, String> {
    let mut records = load()?;
    let Some(index) = records.iter().rposition(|record| {
        record.app_id == app_id && !record.acknowledged && !record.cancelled
    }) else {
        return Ok(None);
    };
    if records[index].completed_at_ms.is_none() {
        records[index].completed_at_ms = Some(now_ms());
        save(&records)?;
    }
    Ok(Some(records[index].clone()))
}

pub fn cancel_latest_for_app(app_id: u32) -> Result<Option<DownloadJobRecord>, String> {
    let mut records = load()?;
    let Some(index) = records.iter().rposition(|record| {
        record.app_id == app_id && !record.acknowledged && record.completed_at_ms.is_none()
    }) else {
        return Ok(None);
    };
    records[index].cancelled = true;
    save(&records)?;
    Ok(Some(records[index].clone()))
}

pub fn acknowledge(job_id: &str) -> Result<Option<DownloadJobRecord>, String> {
    let mut records = load()?;
    let Some(index) = records.iter().position(|record| record.job_id == job_id) else {
        return Ok(None);
    };
    records[index].acknowledged = true;
    save(&records)?;
    Ok(Some(records[index].clone()))
}

pub fn pending_with<F>(mut installed: F) -> Result<Vec<DownloadJobRecord>, String>
where
    F: FnMut(u32) -> bool,
{
    let mut records = load()?;
    let mut changed = false;
    let completed_at = now_ms();
    for record in records.iter_mut() {
        if record.acknowledged || record.cancelled || record.completed_at_ms.is_some() {
            continue;
        }
        if installed(record.app_id) {
            record.completed_at_ms = Some(completed_at);
            changed = true;
        }
    }
    if changed {
        save(&records)?;
    }
    let mut pending: Vec<_> = records
        .into_iter()
        .filter(|record| !record.acknowledged && !record.cancelled && record.completed_at_ms.is_some())
        .collect();
    pending.sort_by_key(|record| (record.completed_at_ms.unwrap_or(u64::MAX), record.requested_at_ms));
    Ok(pending)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_filter_requires_a_real_registered_job() {
        let records = vec![
            DownloadJobRecord { app_id: 1, job_id: "a".into(), requested_at_ms: 1, completed_at_ms: Some(2), acknowledged: false, cancelled: false },
            DownloadJobRecord { app_id: 2, job_id: "b".into(), requested_at_ms: 1, completed_at_ms: Some(2), acknowledged: true, cancelled: false },
            DownloadJobRecord { app_id: 3, job_id: "c".into(), requested_at_ms: 1, completed_at_ms: Some(2), acknowledged: false, cancelled: true },
        ];
        let pending: Vec<_> = records.into_iter().filter(|record| !record.acknowledged && !record.cancelled && record.completed_at_ms.is_some()).collect();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].job_id, "a");
    }
}
