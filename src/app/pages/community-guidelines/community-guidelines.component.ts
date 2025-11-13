import { CommonModule } from '@angular/common';
import { Component, OnInit, AfterViewInit, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-community-guidelines',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './community-guidelines.component.html',
  styleUrl: './community-guidelines.component.css'
})
export class CommunityGuidelinesComponent implements OnInit, AfterViewInit {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  
  today: string;

  constructor() {
    this.today = new Date().toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  ngOnInit() {
    // Scroll to top when component initializes
    window.scrollTo(0, 0);
  }

  ngAfterViewInit() {
    // Ensure scroll to top after view is initialized
    window.scrollTo(0, 0);
  }

  async navigateToHomeOrLanding() {
    const user = this.authService.currentUser;
    if (user) {
      await this.router.navigate(['/home']);
    } else {
      await this.router.navigate(['/']);
    }
  }
}
