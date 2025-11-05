import { CommonModule } from '@angular/common';
import { Component, OnInit, AfterViewInit } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-community-guidelines',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './community-guidelines.component.html',
  styleUrl: './community-guidelines.component.css'
})
export class CommunityGuidelinesComponent implements OnInit, AfterViewInit {
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
}
