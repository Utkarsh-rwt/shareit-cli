const dgram = require("dgram");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const UDP_PORT = 41234;
const REQUEST_TIMEOUT_MS = 30000;
const META_TIMEOUT_MS = 5000;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseTotalFromContentRange = (contentRange) => {
    if (!contentRange) return null;

    const total = contentRange.split("/")[1];
    const parsed = Number(total);

    return Number.isFinite(parsed) ? parsed : null;
};

const parseFilenameFromContentDisposition = (contentDisposition) => {
    if (!contentDisposition || typeof contentDisposition !== "string") {
        return null;
    }

    // RFC 5987 format: filename*=UTF-8''encoded-name
    const encodedMatch = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
    if (encodedMatch && encodedMatch[1]) {
        try {
            const decoded = decodeURIComponent(encodedMatch[1].trim());
            return path.basename(decoded);
        } catch {
            return path.basename(encodedMatch[1].trim());
        }
    }

    // Classic format: filename="name.ext" or filename=name.ext
    const simpleMatch = /filename="?([^";]+)"?/i.exec(contentDisposition);
    if (simpleMatch && simpleMatch[1]) {
        return path.basename(simpleMatch[1].trim());
    }

    return null;
};

const ensureUniquePath = (fileName) => {
    const parsed = path.parse(fileName);
    let candidate = fileName;
    let index = 1;

    while (fs.existsSync(candidate) || fs.existsSync(`${candidate}.part`)) {
        candidate = `${parsed.name}(${index})${parsed.ext}`;
        index += 1;
    }

    return candidate;
};

const getRemoteMeta = async (baseUrl) => {
    try {
        const response = await axios.get(`${baseUrl}/meta`, {
            timeout: META_TIMEOUT_MS,
            validateStatus: (status) => status === 200
        });

        if (!response.data || !response.data.name) {
            return { name: "received_file", size: null };
        }

        return {
            name: path.basename(response.data.name),
            size: Number.isFinite(Number(response.data.size)) ? Number(response.data.size) : null
        };
    } catch {
        return { name: "received_file", size: null };
    }
};

const pipeToFile = (readable, filePath, flags) => {
    return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(filePath, { flags });

        readable.pipe(writer);

        readable.on("error", reject);
        writer.on("error", reject);
        writer.on("finish", resolve);
    });
};

const downloadWithRetry = async (baseUrl, outputFile, expectedTotalSize) => {
    let resolvedOutputFile = outputFile;
    let tempFile = `${resolvedOutputFile}.part`;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        const existingSize = fs.existsSync(tempFile) ? fs.statSync(tempFile).size : 0;
        const headers = existingSize > 0 ? { Range: `bytes=${existingSize}-` } : {};

        try {
            const response = await axios({
                method: "GET",
                url: `${baseUrl}/download`,
                responseType: "stream",
                headers,
                timeout: REQUEST_TIMEOUT_MS,
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
                validateStatus: (status) => status === 200 || status === 206
            });

            const isResumeResponse = response.status === 206 && existingSize > 0;
            const writeFlags = isResumeResponse ? "a" : "w";

            if (attempt === 1 && existingSize === 0 && resolvedOutputFile === "received_file") {
                const headerName = parseFilenameFromContentDisposition(response.headers["content-disposition"]);

                if (headerName) {
                    resolvedOutputFile = ensureUniquePath(headerName);
                    tempFile = `${resolvedOutputFile}.part`;
                }
            }

            if (existingSize > 0 && writeFlags === "w") {
                console.log("Server did not resume. Restarting transfer from beginning...");
            }

            const rangeTotal = parseTotalFromContentRange(response.headers["content-range"]);
            const responseLength = Number(response.headers["content-length"] || 0);
            const inferredTotal = rangeTotal || (response.status === 200 ? responseLength : existingSize + responseLength);
            const targetTotal = expectedTotalSize || inferredTotal || null;

            await pipeToFile(response.data, tempFile, writeFlags);

            const currentSize = fs.statSync(tempFile).size;

            if (targetTotal && currentSize < targetTotal) {
                throw new Error(`Partial download (${currentSize}/${targetTotal})`);
            }

            fs.renameSync(tempFile, resolvedOutputFile);
            return resolvedOutputFile;
        } catch (err) {
            if (attempt >= MAX_RETRIES) {
                throw err;
            }

            console.log(`Download interrupted (attempt ${attempt}/${MAX_RETRIES}). Retrying...`);
            await sleep(RETRY_DELAY_MS * attempt);
        }
    }
};

const receive = () => {
    const client = dgram.createSocket("udp4");
    let started = false;

    client.on("message", async (msg) => {
        if (started) {
            return;
        }

        const data = msg.toString();

        if (data.startsWith("FILE_SERVER")) {
            started = true;
            const [, ip, port] = data.split(":");

            // Stop listening once a sender is discovered.
            client.close();

            console.log("Found sender:", ip);

            const baseUrl = `http://${ip}:${port}`;

            try {
                const meta = await getRemoteMeta(baseUrl);
                const finalFile = ensureUniquePath(meta.name);

                console.log(`Saving as: ${finalFile}`);
                const savedAs = await downloadWithRetry(baseUrl, finalFile, meta.size);

                console.log(`File downloaded successfully: ${savedAs}`);
                client.close();

            } catch (err) {
                console.log("Download error:", err.message);
                started = false;
            }
        }
    });

    client.bind(UDP_PORT, () => {
        console.log("Searching for sender...");
    });
};

module.exports = receive;