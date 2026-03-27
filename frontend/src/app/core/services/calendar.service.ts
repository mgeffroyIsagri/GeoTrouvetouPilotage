import { Injectable } from '@angular/core';

/** Métadonnées statiques d'un sprint au sein d'un PI. */
export interface SprintInfo {
  number: number;
  label: string;
  weeks: number;
  workingDays: number;  // = weeks * 5
}

/**
 * Configuration des 4 sprints d'un PI GeoTrouvetou.
 * Durées : S1 = 3 sem, S2 = 3 sem, S3 = 4 sem, IP = 3 sem.
 * Chaque sprint commence un vendredi.
 */
export const SPRINT_CONFIG: SprintInfo[] = [
  { number: 1, label: 'Sprint 1',   weeks: 3, workingDays: 15 },
  { number: 2, label: 'Sprint 2',   weeks: 3, workingDays: 15 },
  { number: 3, label: 'Sprint 3',   weeks: 4, workingDays: 20 },
  { number: 4, label: 'IP Sprint',  weeks: 3, workingDays: 15 },
];

/**
 * Utilitaires de manipulation des dates et des positions (`day_offset`) dans les sprints.
 * La référence temporelle est le `day_offset` : `0.0` = vendredi de début de sprint,
 * `0.5` = vendredi après-midi, `1.0` = lundi suivant, etc.
 */
@Injectable({ providedIn: 'root' })
export class CalendarService {

  /**
   * Retourne la liste ordonnée des jours ouvrés d'un sprint.
   * Le sprint commence un vendredi. Séquence: ven, lun, mar, mer, jeu, ven, lun…
   * @param sprintStart Date de début du sprint (doit être un vendredi).
   * @param weeks Nombre de semaines du sprint.
   */
  getWorkingDays(sprintStart: Date, weeks: number): Date[] {
    const days: Date[] = [];
    const current = new Date(sprintStart);
    const totalDays = weeks * 7;
    const endDate = new Date(sprintStart);
    endDate.setDate(endDate.getDate() + totalDays - 1);

    while (current <= endDate) {
      const dow = current.getDay(); // 0=dim, 1=lun, ..., 5=sam, 6=dim
      if (dow !== 0 && dow !== 6) {
        days.push(new Date(current));
      }
      current.setDate(current.getDate() + 1);
    }
    return days;
  }

  /**
   * Convertit un `day_offset` en position CSS `left` (px).
   * @param dayOffset Position dans le sprint (peut être décimale, ex. 0.5 = demi-journée).
   * @param colWidth Largeur en pixels d'une colonne (= 1 jour ouvré).
   */
  offsetToPixel(dayOffset: number, colWidth: number): number {
    return dayOffset * colWidth;
  }

  /**
   * Convertit un pixel X (relatif au conteneur du planning) en `day_offset`, snappé à 0.5.
   * @param px Position horizontale en pixels.
   * @param colWidth Largeur en pixels d'une colonne.
   * @param maxDays Nombre total de jours ouvrés du sprint (borne supérieure).
   */
  pixelToOffset(px: number, colWidth: number, maxDays: number): number {
    const raw = px / colWidth;
    const snapped = Math.round(raw * 2) / 2;
    return Math.max(0, Math.min(maxDays - 0.5, snapped));
  }

  /**
   * Formate un jour ouvré pour l'affichage en en-tête de colonne du planning.
   * @returns `{ shortDay: 'Lu', dayNum: '07', monthNum: '03' }`
   */
  formatDayHeader(date: Date): { shortDay: string; dayNum: string; monthNum: string } {
    const days = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'];
    return {
      shortDay: days[date.getDay()],
      dayNum: date.getDate().toString().padStart(2, '0'),
      monthNum: (date.getMonth() + 1).toString().padStart(2, '0'),
    };
  }

  /**
   * Retourne les groupes de semaines ISO pour les séparateurs visuels du planning.
   * Chaque groupe indique le libellé de semaine (`S12`) et le nombre de jours ouvrés qu'elle contient.
   */
  getWeekGroups(workingDays: Date[]): Array<{ label: string; count: number }> {
    const groups: Array<{ label: string; count: number }> = [];
    let week = 0;
    let count = 0;
    let weekLabel = '';

    for (const day of workingDays) {
      const currentWeek = this.getWeekNumber(day);
      if (currentWeek !== week) {
        if (count > 0) groups.push({ label: weekLabel, count });
        week = currentWeek;
        count = 0;
        weekLabel = `S${currentWeek}`;
      }
      count++;
    }
    if (count > 0) groups.push({ label: weekLabel, count });
    return groups;
  }

  /** Calcule le numéro de semaine ISO 8601 d'une date. */
  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  /**
   * Indique si une date correspond au premier jour d'une nouvelle semaine de sprint.
   * Dans le calendrier GeoTrouvetou, la semaine de sprint commence le vendredi.
   */
  isWeekStart(date: Date): boolean {
    return date.getDay() === 5; // vendredi
  }

  /**
   * Calcule la date calendaire correspondant à un `day_offset` dans un sprint.
   * @returns La date ou `null` si l'offset dépasse la durée du sprint.
   */
  offsetToDate(sprintStart: Date, weeks: number, offset: number): Date | null {
    const workingDays = this.getWorkingDays(sprintStart, weeks);
    const idx = Math.floor(offset);
    return workingDays[idx] ?? null;
  }

  /**
   * Convertit une date calendaire en `day_offset` dans un sprint.
   * @returns L'index (0-based) du jour ouvré, ou `-1` si la date est hors du sprint.
   */
  dateToOffset(date: Date, workingDays: Date[]): number {
    const iso = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    return workingDays.findIndex((d) => {
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` === iso;
    });
  }

  /** Formate un jour ouvré en chaîne ISO `YYYY-MM-DD`. */
  workingDayToISO(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
}
