require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const port = 3000;
const SERVERS_DB = path.join(__dirname, 'servers.json');
const ADMIN_DISCORD_ID = '1435148566850048114'; // Deine Discord ID

// --- NEU: Stellt sicher, dass die Datenbankdatei existiert ---
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(publicDir, 'uploads');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

if (!fs.existsSync(SERVERS_DB)) {
    console.log('Datenbankdatei (servers.json) nicht gefunden. Erstelle neue Datei...');
    fs.writeFileSync(SERVERS_DB, JSON.stringify([]));
}

// Session-Middleware einrichten
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
}));

// Statische Dateien (wie index.html) bereitstellen
app.use(express.static(path.join(__dirname, 'views')));
// Statische Dateien aus dem "public" Ordner bereitstellen (für die Bilder)
app.use(express.static(publicDir));

// Multer-Konfiguration für den Datei-Upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        // Erstellt einen einzigartigen Dateinamen, um Konflikte zu vermeiden
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });
// Middleware zum Parsen von Formulardaten
app.use(express.urlencoded({ extended: true }));

// Middleware, um zu prüfen, ob ein Benutzer angemeldet ist
function isLoggedIn(req, res, next) {
    if (req.session.user) {
        return next(); // Wenn ja, fahre fort
    }
    // Wenn nicht, leite zur Startseite um
    res.redirect('/');
}
// Middleware, um zu prüfen, ob der Benutzer ein Admin ist
function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.id === ADMIN_DISCORD_ID) {
        return next();
    }
    // Wenn nicht, sende einen Fehler
    res.status(403).send('Zugriff verweigert. Nur für Admins.');
}

// Route 1: Startet den Discord-Login-Prozess
app.get('/auth/discord', (req, res) => {
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(`http://localhost:${port}/auth/discord/callback`)}&response_type=code&scope=identify`;
    res.redirect(discordAuthUrl);
});

// Route 2: Callback-Route, die Discord nach dem Login aufruft
app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
        return res.status(400).send('Fehler: Kein Autorisierungscode von Discord erhalten.');
    }

    try {
        // Tausche den Code gegen ein Access Token
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: `http://localhost:${port}/auth/discord/callback`,
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        const accessToken = tokenResponse.data.access_token;

        // Hole die Benutzerinformationen mit dem Access Token
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
        });

        // Speichere Benutzerdaten in der Session
        req.session.user = userResponse.data;

        // Leite zur Hauptseite zurück
        res.redirect('/');

    } catch (error) {
        console.error('Fehler bei der Discord-Authentifizierung:', error);
        res.status(500).send('Ein interner Serverfehler ist aufgetreten.');
    }
});

// API-Endpunkt, um den eingeloggten Benutzer abzufragen (wird von der index.html genutzt)
app.get('/api/user', (req, res) => {
    if (req.session.user) {
        res.json(req.session.user);
    } else {
        res.status(404).json({ message: 'Nicht angemeldet' });
    }
});

// Logout-Route
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).send('Konnte nicht ausloggen.');
        }
        res.redirect('/');
    });
});

// --- NEUE ROUTEN ---

// Route, um die Seite "Server hinzufügen" anzuzeigen
// Die isLoggedIn-Middleware schützt diese Route
app.get('/add-server', isLoggedIn, (req, res) => { 
    res.sendFile(path.join(__dirname, 'views', 'add-server.html'));
});

// Route, um die Formulardaten zu verarbeiten
app.post('/add-server', isLoggedIn, upload.single('serverImage'), (req, res) => {
    fs.readFile(SERVERS_DB, 'utf8', (err, data) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Fehler beim Lesen der Server-Datenbank.');
        }
        const servers = JSON.parse(data);
        const newServer = {
            id: crypto.randomBytes(8).toString('hex'), // Eindeutige ID
            inviteLink: req.body.inviteLink,
            serverName: req.body.serverName,
            description: req.body.description,
            imageUrl: req.file ? `/uploads/${req.file.filename}` : null, // Speichere den Pfad zum Bild
            status: 'pending', // Standardstatus
            submittedBy: {
                id: req.session.user.id,
                username: req.session.user.username
            }
        };
        servers.push(newServer);
        fs.writeFile(SERVERS_DB, JSON.stringify(servers, null, 2), (err) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Fehler beim Speichern des Servers.');
            }
            res.send('Danke! Dein Server wurde zur Überprüfung eingereicht und wird bald hinzugefügt. <a href="/">Zurück zur Startseite</a>');
        });
    });
});

// Admin-Dashboard anzeigen
app.get('/admin', isLoggedIn, isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// API-Routen für die Server-Verwaltung
app.get('/api/servers', (req, res) => {
    fs.readFile(SERVERS_DB, 'utf8', (err, data) => {
        if (err) return res.status(500).json([]);
        const servers = JSON.parse(data);
        // Wenn der Anfragende kein Admin ist, nur angenommene Server senden
        if (!req.session.user || req.session.user.id !== ADMIN_DISCORD_ID) {
            return res.json(servers.filter(s => s.status === 'approved'));
        }
        res.json(servers); // Admins sehen alle
    });
});

app.post('/api/servers/:id/:action', isLoggedIn, isAdmin, (req, res) => {
    const { id, action } = req.params;
    fs.readFile(SERVERS_DB, 'utf8', (err, data) => {
        if (err) return res.status(500).send('Fehler');
        let servers = JSON.parse(data);
        const serverIndex = servers.findIndex(s => s.id === id);
        if (serverIndex === -1) return res.status(404).send('Server nicht gefunden');

        if (action === 'approve') servers[serverIndex].status = 'approved';
        else if (action === 'decline' || action === 'delete') servers.splice(serverIndex, 1);
        else return res.status(400).send('Ungültige Aktion');

        fs.writeFile(SERVERS_DB, JSON.stringify(servers, null, 2), (err) => {
            if (err) return res.status(500).send('Fehler beim Speichern');
            res.status(200).send('Aktion erfolgreich');
        });
    });
});

app.listen(port, () => {
    console.log(`Server läuft auf http://localhost:${port}`);
});
