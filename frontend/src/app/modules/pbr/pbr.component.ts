import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../core/services/api.service';
import { PBRSession, PBRVote } from '../../core/models';

@Component({
  selector: 'app-pbr',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pbr.component.html',
  styleUrl: './pbr.component.scss',
})
export class PbrComponent implements OnInit {
  sessions: PBRSession[] = [];
  activeSession: PBRSession | null = null;
  votes: PBRVote[] = [];

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.listPBRSessions().subscribe((sessions) => {
      this.sessions = sessions;
      this.activeSession = sessions.find((s) => s.is_active) ?? null;
      if (this.activeSession) {
        this.loadVotes(this.activeSession.id);
      }
    });
  }

  loadVotes(sessionId: number): void {
    this.api.getVotes(sessionId).subscribe((votes) => {
      this.votes = votes;
    });
  }
}
