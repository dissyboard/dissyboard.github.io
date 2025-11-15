require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');


const app = express();
const port = 3000;

// Lade die Konfiguration aus der .env Datei
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
// Die Vercel-URL wird automatisch gesetzt, für lokale Entwicklung verwenden wir localhost.
const BASE_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${port}`;
const REDIRECT_URI = `${BASE_URL}/auth/discord/callback`;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'default_secret', 
    resave: false,
    saveUninitialized: true,
}));

app.use(express.static(path.join(__dirname, 'views')));



app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/auth/discord', (req, res) => {
    const authorizeUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(authorizeUrl);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
        return res.send('Fehler: Es wurde kein Code von Discord empfangen.');
    }

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        const accessToken = tokenResponse.data.access_token;

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        req.session.user = userResponse.data;
        res.redirect('/');

    } catch (error) {
        console.error('Fehler bei der Discord-Authentifizierung:', error);
        res.send('Ein Fehler ist aufgetreten.');
    }
});

app.get('/api/user', (req, res) => {
    if (req.session.user) {
        res.json(req.session.user);
    } else {
        res.status(401).json({ error: 'Nicht angemeldet' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

app.get('/add-server', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/'); 
    }
    res.sendFile(path.join(__dirname, 'views', 'add-server.html'));
});

app.post('/submit-server', (req, res) => {
    if (!req.session.user) {
        return res.status(403).send('Du musst angemeldet sein.');
    }
    const { serverName, description, games } = req.body;
    console.log('Neuer Server hinzugefügt:');
    console.log(`  Name: ${serverName}`);
    console.log(`  Beschreibung: ${description}`);
    console.log(`  Spiele: ${games}`);
    console.log(`  Hinzugefügt von: ${req.session.user.username}`);
    
    res.redirect('/');
});


// Lokal den Server starten
if (!process.env.VERCEL_URL) {
    app.listen(port, () => {
        console.log(`Server läuft auf http://localhost:${port}`);
    });
}

module.exports = app; // Exportiere die App für Vercel
