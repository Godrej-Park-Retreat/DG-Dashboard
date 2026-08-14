from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path

import requests

DRIVE_API = "https://www.googleapis.com/drive/v3"


def service_account_credentials():
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not raw:
        return None
    from google.oauth2 import service_account
    return service_account.Credentials.from_service_account_info(
        json.loads(raw),
        scopes=["https://www.googleapis.com/auth/drive.readonly"],
    )


def download_private(file_id: str, destination: Path, creds) -> None:
    from google.auth.transport.requests import AuthorizedSession
    session = AuthorizedSession(creds)
    meta = session.get(f"{DRIVE_API}/files/{file_id}", params={"fields": "id,name,mimeType,capabilities"})
    meta.raise_for_status()
    metadata = meta.json()
    mime = metadata.get("mimeType", "")
    if mime == "application/vnd.google-apps.spreadsheet":
        response = session.get(
            f"{DRIVE_API}/files/{file_id}/export",
            params={"mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
        )
    else:
        response = session.get(f"{DRIVE_API}/files/{file_id}", params={"alt": "media"})
    response.raise_for_status()
    destination.write_bytes(response.content)
    print(f"Downloaded {metadata.get('name')} ({mime}) -> {destination}")


def download_public(file_id: str, destination: Path) -> None:
    # First try the Google Sheets XLSX export URL. This also makes the script work
    # when the source is actually a Google Sheet shared by link.
    export_url = f"https://docs.google.com/spreadsheets/d/{file_id}/export?format=xlsx"
    response = requests.get(export_url, timeout=60, allow_redirects=True)
    content = response.content
    if response.ok and content[:2] == b"PK":
        destination.write_bytes(content)
        print(f"Downloaded public Google Sheet as XLSX {file_id} -> {destination}")
        return

    # Otherwise try a normal Drive blob download.
    url = f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t"
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    content = response.content
    if content[:2] != b"PK":
        raise RuntimeError("Drive did not return an XLSX. Make the file link-accessible or configure GOOGLE_SERVICE_ACCOUNT_JSON.")
    destination.write_bytes(content)
    print(f"Downloaded public Drive file {file_id} -> {destination}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file-id", default=os.environ.get("GOOGLE_DRIVE_FILE_ID"))
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    if not args.file_id:
        raise SystemExit("GOOGLE_DRIVE_FILE_ID is required")
    destination = Path(args.out)
    destination.parent.mkdir(parents=True, exist_ok=True)
    creds = service_account_credentials()
    if creds:
        download_private(args.file_id, destination, creds)
    else:
        download_public(args.file_id, destination)


if __name__ == "__main__":
    main()
