# Shareit CLI

Shareit CLI is a local network file transfer tool for Node.js.
It helps you send a file or folder from one machine to another on the same Wi-Fi or LAN.

## How it works

1. The sender resolves the input path and checks file system metadata.
2. If the input is a directory, the sender creates a temporary ZIP archive in the OS temp directory using `archiver`.
3. The sender starts an HTTP server on `0.0.0.0:5000` with two endpoints:
	- `GET /meta` returns JSON metadata (`name`, `size`, `mtimeMs`).
	- `GET /download` streams file bytes and supports HTTP range requests.
4. The sender opens a UDP socket and broadcasts discovery packets every 2 seconds on port `41234`.
	- Packet format: `FILE_SERVER:<sender-ip>:5000`.
	- Broadcast target: `255.255.255.255:41234`.
5. The receiver binds to UDP `41234`, waits for the first valid discovery packet, then stops listening.
6. The receiver fetches `/meta` and prepares a unique local output name to avoid overwrite collisions.
7. The receiver downloads from `/download` using streamed HTTP responses.
	- On interruption, it retries up to 5 times.
	- If partial data exists, it sends `Range: bytes=<offset>-` to resume.
	- If resume is not accepted by the sender, it restarts the transfer from byte 0.
8. On completion, the receiver renames `<filename>.part` to the final filename.
9. When a receiver connects to `/download`, the sender stops UDP broadcasting.
10. On sender shutdown, temporary ZIP artifacts are removed.

## Requirements

- Node.js 18+
- Both devices must be on the same network
- Firewall must allow:
	- UDP `41234`
	- TCP `5000`

## Install

```bash
npm install
```

Optional global command for local development:

```bash
npm link
```

Then run with:

```bash
shareit
```

Without linking globally, run with:

```bash
node index.js
```

## Usage

Start the app on both devices:

```bash
node index.js
```

You will see a prompt:

```text
Type <send> to send files and <recieve> to recieve files
```

### Send

1. On the sender machine, type `send`.
2. Enter a file path or folder path.
3. Keep the sender process running.

### Receive

1. On the receiver machine, type `recieve`.
2. Wait for discovery and download.
3. The file is saved in the current working directory.

If a file with the same name already exists, a new name like `name(1).ext` is used.

## Notes

- Current prompt keywords are `send` and `recieve`.
- Folder transfer is sent as a `.zip` file.
- Temporary zip files are cleaned up when sender exits.
