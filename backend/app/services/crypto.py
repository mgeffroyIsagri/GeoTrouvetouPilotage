"""Chiffrement symétrique des secrets applicatifs (PAT, clés API)."""
import os
import base64
import hashlib
from cryptography.fernet import Fernet, InvalidToken

# Clés considérées comme sensibles → chiffrées en BDD, masquées dans l'API
SENSITIVE_KEYS: set[str] = {"azdo_pat", "llm_api_key"}

_ENCRYPTED_PREFIX = "enc:"
_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    """Retourne l'instance Fernet en cache (singleton par processus)."""
    global _fernet
    if _fernet is not None:
        return _fernet
    key = _load_or_create_key()
    _fernet = Fernet(key)
    return _fernet


def _key_file_path() -> str:
    """Retourne le chemin du fichier de clé selon l'environnement d'exécution.

    Sur Azure App Service (``WEBSITE_SITE_NAME`` défini), utilise ``/home``
    qui est un volume persistant. En local, utilise le répertoire ``backend/``.
    """
    if os.environ.get("WEBSITE_SITE_NAME"):
        return "/home/.secret_key"
    # Répertoire courant lors du lancement (backend/)
    return ".secret_key"


def _load_or_create_key() -> bytes:
    """Charge ou génère la clé de chiffrement.

    Ordre de priorité :
    1. Variable d'env APP_SECRET_KEY (dérivée via SHA-256)
    2. Fichier .secret_key (clé Fernet persistée)
    3. Génération d'une nouvelle clé + écriture dans le fichier
    """
    secret_env = os.environ.get("APP_SECRET_KEY")
    if secret_env:
        # Dériver une clé Fernet valide (32 octets, base64 URL-safe)
        return base64.urlsafe_b64encode(hashlib.sha256(secret_env.encode()).digest())

    key_file = _key_file_path()
    if os.path.exists(key_file):
        with open(key_file, "rb") as f:
            return f.read().strip()

    # Générer et persister
    key = Fernet.generate_key()
    with open(key_file, "wb") as f:
        f.write(key)
    return key


def encrypt_value(plaintext: str) -> str:
    """Chiffre une valeur. Retourne 'enc:<ciphertext>'."""
    if not plaintext:
        return plaintext
    token = _get_fernet().encrypt(plaintext.encode()).decode()
    return f"{_ENCRYPTED_PREFIX}{token}"


def decrypt_value(value: str | None) -> str | None:
    """Déchiffre une valeur. Si non chiffrée (migration), retourne telle quelle."""
    if not value:
        return value
    if value.startswith(_ENCRYPTED_PREFIX):
        try:
            cipher = value[len(_ENCRYPTED_PREFIX):]
            return _get_fernet().decrypt(cipher.encode()).decode()
        except (InvalidToken, Exception):
            return value  # fallback si déchiffrement impossible
    return value  # valeur en clair (avant migration)


def is_encrypted(value: str | None) -> bool:
    """Retourne ``True`` si la valeur a déjà été chiffrée (préfixe ``enc:``)."""
    return bool(value and value.startswith(_ENCRYPTED_PREFIX))
