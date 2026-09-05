module.exports = {
    apps: [
        {
            name: "crypto-api",
            script: "application/crypto/api/serveur.js",
            // Redemarrage automatique des que le code change
            watch: [
                "application/crypto/api",
                "application/_commun/api"
            ],
            ignore_watch: [
                "node_modules",
                ".git"
            ],
            watch_delay: 500,
            autorestart: true,
            max_restarts: 10,
            time: true
        }
    ]
}
