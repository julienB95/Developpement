module.exports = {
    apps: [
        {
            name: "mon-site-test",
            script: "server.js",
            watch: false
        },
        {
            name: "crypto-api",
            script: "application/crypto/api/serveur.js",
            watch: false
        }
    ]
}
