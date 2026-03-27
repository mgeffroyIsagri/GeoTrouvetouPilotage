import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';

/**
 * Service d'authentification JWT.
 * Gère la connexion, la déconnexion, la persistance du token dans `localStorage`
 * et la vérification de son expiration.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  /** Clé utilisée pour stocker le JWT dans `localStorage`. */
  private readonly tokenKey = 'gtp_auth_token';

  private readonly base = window.location.hostname === 'localhost'
    ? 'http://localhost:8002/api'
    : '/api';

  constructor(private http: HttpClient, private router: Router) {}

  /**
   * Authentifie l'utilisateur et stocke le token JWT retourné par le backend.
   * @returns Un Observable qui complète une fois le token persisté.
   */
  login(username: string, password: string): Observable<void> {
    return this.http.post<{ access_token: string }>(
      `${this.base}/auth/login`,
      { username, password }
    ).pipe(
      tap((res) => localStorage.setItem(this.tokenKey, res.access_token)),
      // map to void
      tap(() => {})
    ) as unknown as Observable<void>;
  }

  /**
   * Déconnecte l'utilisateur en supprimant le token local et redirige vers `/login`.
   */
  logout(): void {
    localStorage.removeItem(this.tokenKey);
    this.router.navigate(['/login']);
  }

  /** Retourne le token JWT courant, ou `null` s'il n'existe pas. */
  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  /**
   * Vérifie si l'utilisateur est authentifié en s'assurant que le token existe
   * et que sa date d'expiration (`exp`) n'est pas dépassée.
   */
  isLoggedIn(): boolean {
    const token = this.getToken();
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  /**
   * Permet à l'utilisateur de changer son mot de passe.
   * @returns Un Observable contenant le message de confirmation du backend.
   */
  changePassword(currentPassword: string, newPassword: string): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.base}/auth/change-password`, {
      current_password: currentPassword,
      new_password: newPassword,
    });
  }
}
