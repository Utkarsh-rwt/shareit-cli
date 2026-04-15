const dgram = require("dgram");
const axios = require("axios");
const fs = require("fs");

const UDP_PORT = 41234;

const receive = () => {
    const client = dgram.createSocket("udp4");

    client.on("message", async (msg) => {
        const data = msg.toString();

        if (data.startsWith("FILE_SERVER")) {
            const [, ip, port] = data.split(":");

            console.log("Found sender:", ip);

            const url = `http://${ip}:${port}/download`;

            try {
                const response = await axios({
                    method: "GET",
                    url,
                    responseType: "stream"
                });

                const writer = fs.createWriteStream("received_file");

                response.data.pipe(writer);

                writer.on("finish", () => {
                    console.log(" File downloaded!");
                });

            } catch (err) {
                console.log("❌ Download error:", err.message);
            }
        }
    });

    client.bind(UDP_PORT, () => {
        console.log("Searching for sender...");
    });
};

module.exports = receive;