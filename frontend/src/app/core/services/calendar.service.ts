import { Injectable } from '@angular/core';

export interface SprintInfo {
  number: number;
  label: string;
  weeks: number;
  workingDays: number;  // = weeks * 5
}

export const SPRINT_CONFIG: SprintInfo[] = [
  { number: 1, label: 'Sprint 1',   weeks: 3, workingDays: 15 },
  { number: 2, label: 'Sprint 2',   weeks: 3, workingDays: 15 },
  { number: 3, label: 'Sprint 3',   weeks: 4, workingDays: 20 },
  { number: 4, label: 'IP Sprint',  weeks: 3, workingDays: 15 },
];

@Injectable({ providedIn: 'root' })
export class CalendarService {

  /** Retourne les jours ouvrés d'un sprint.
   *  Le sprint commence un vendredi. Séquence: ven, lun, mar, mer, jeu, ven, lun... */
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

  /** Convertit un day_offset en position CSS left (px). */
  offsetToPixel(dayOffset: number, colWidth: number): number {
    return dayOffset * colWidth;
  }

  /** Convertit un pixel X (relatif au conteneur) en day_offset, snappé à 0.5. */
  pixelToOffset(px: number, colWidth: number, maxDays: number): number {
    const raw = px / colWidth;
    const snapped = Math.round(raw * 2) / 2;
    return Math.max(0, Math.min(maxDays - 0.5, snapped));
  }

  /** Formatte un jour ouvré pour l'affichage en en-tête de colonne. */
  formatDayHeader(date: Date): { shortDay: string; dayNum: string } {
    const days = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'];
    return {
      shortDay: days[date.getDay()],
      dayNum: date.getDate().toString().padStart(2, '0'),
    };
  }

  /** Retourne les groupes de semaines pour les séparateurs visuels. */
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

  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  /** Vérifie si une date est le 1er jour d'une nouvelle semaine du sprint (vendredi). */
  isWeekStart(date: Date): boolean {
    return date.getDay() === 5; // vendredi
  }

  /** Calcule la date correspondant à un day_offset dans un sprint. */
  offsetToDate(sprintStart: Date, weeks: number, offset: number): Date | null {
    const workingDays = this.getWorkingDays(sprintStart, weeks);
    const idx = Math.floor(offset);
    return workingDays[idx] ?? null;
  }
}
