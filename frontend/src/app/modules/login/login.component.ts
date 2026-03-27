import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

/**
 * Composant de connexion.
 *
 * Affiche un formulaire simple (identifiant + mot de passe).
 * En cas de succès, redirige vers `/pi-planning`.
 * En cas d'échec, affiche le message d'erreur retourné par l'API.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  // ── Champs du formulaire ──────────────────────────────────

  /** Identifiant saisi par l'utilisateur. */
  username = '';

  /** Mot de passe saisi par l'utilisateur. */
  password = '';

  // ── États UI ──────────────────────────────────────────────

  /** Vrai pendant la requête d'authentification. */
  loading = false;

  /** Message d'erreur affiché en cas d'échec de connexion. */
  error = '';

  constructor(private authService: AuthService, private router: Router) {}

  // ── Actions ───────────────────────────────────────────────

  /**
   * Soumet le formulaire de connexion.
   * Ne fait rien si l'identifiant ou le mot de passe est vide.
   * Redirige vers `/pi-planning` en cas de succès.
   * Affiche le détail de l'erreur API (ou un message générique) en cas d'échec.
   */
  onSubmit(): void {
    if (!this.username || !this.password) return;
    this.loading = true;
    this.error = '';

    this.authService.login(this.username, this.password).subscribe({
      next: () => {
        this.loading = false;
        this.router.navigate(['/pi-planning']);
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.detail ?? 'Identifiants incorrects';
      },
    });
  }
}
