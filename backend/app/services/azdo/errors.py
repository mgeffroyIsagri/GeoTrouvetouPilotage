"""Mapping des exceptions httpx vers des messages d'erreur lisibles pour l'utilisateur."""

import httpx


def map_azdo_error(exc: Exception) -> str:
    """Convertit une exception AZDO en message d'erreur lisible.

    Gère les cas les plus courants : mauvais PAT (401), permissions insuffisantes
    (403), ressource introuvable (404), timeout et erreur réseau.

    Args:
        exc: Exception levée lors d'un appel AZDO.

    Returns:
        Message d'erreur en français, prêt à afficher dans l'interface.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status == 401:
            return "Authentification refusée : PAT invalide ou expiré"
        if status == 403:
            return "Accès refusé : permissions insuffisantes sur le PAT"
        if status == 404:
            return "Ressource introuvable : vérifiez l'organisation, le projet ou l'équipe"
        return f"Erreur HTTP {status} : {exc.response.text[:200]}"
    if isinstance(exc, httpx.TimeoutException):
        return "Délai de connexion dépassé, vérifiez l'URL de l'organisation"
    if isinstance(exc, httpx.ConnectError):
        return "Impossible de joindre Azure DevOps, vérifiez votre connexion réseau"
    return str(exc)
