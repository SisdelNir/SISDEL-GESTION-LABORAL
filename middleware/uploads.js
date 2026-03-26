const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Crear directorio de uploads si no existe
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Subdirectorios
['evidencias', 'fotos', 'logos'].forEach(dir => {
    const subDir = path.join(uploadsDir, dir);
    if (!fs.existsSync(subDir)) {
        fs.mkdirSync(subDir, { recursive: true });
    }
});

// Configuración de almacenamiento
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const tipo = req.uploadTipo || 'evidencias';
        cb(null, path.join(uploadsDir, tipo));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E6);
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, uniqueSuffix + ext);
    }
});

// Filtro de archivos
const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf'
    ];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Tipo de archivo no permitido. Solo: JPG, PNG, GIF, WEBP, PDF'), false);
    }
};

// Instancias de multer
const uploadEvidencia = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

const uploadFoto = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten imágenes'), false);
        }
    },
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB max
});

// Middleware para asignar tipo de upload
function setUploadTipo(tipo) {
    return (req, res, next) => {
        req.uploadTipo = tipo;
        next();
    };
}

module.exports = { uploadEvidencia, uploadFoto, setUploadTipo, uploadsDir };
