import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { take } from 'rxjs/operators';

interface PromptData {
  name: string;
  content: string;
  customUrl?: string;
}

interface ChatbotLink {
  name: string;
  url: string;
  icon: string;
  color: string;
}

@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './landing-page.component.html',
  styleUrl: './landing-page.component.css'
})
export class LandingPageComponent implements OnInit, AfterViewInit {
  readonly title = signal('rocket-prompt');
  readonly mobileMenuOpen = signal(false);

  promptForm: FormGroup;
  generatedLinks: ChatbotLink[] = [];
  showResults = false;
  characterCount = 0;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {
    this.promptForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(3)]],
      content: ['', [Validators.required, Validators.minLength(10)]],
      customUrl: ['']
    });

    this.promptForm.get('content')?.valueChanges.subscribe(value => {
      this.characterCount = value?.length || 0;
    });
  }

  toggleMobileMenu() {
    this.mobileMenuOpen.update(open => !open);
  }

  closeMobileMenu() {
    this.mobileMenuOpen.set(false);
  }

  ngOnInit() {
    // Redirect logged-in users to home page
    this.authService.currentUser$.pipe(take(1)).subscribe(user => {
      if (user && user.emailVerified) {
        this.router.navigate(['/home']);
      }
    });
  }

  ngAfterViewInit() {
    this.setupSmoothScrolling();
  }

  onSubmit() {
    if (this.promptForm.valid) {
      const promptData: PromptData = this.promptForm.value;
      this.generateShortenedLinks(promptData);
    }
  }

  generateShortUrl(customUrl?: string): string {
    if (customUrl) {
      return `rocketprompt.io/${customUrl}`;
    }

    const randomId = Math.random().toString(36).substring(2, 8);
    return `rocketprompt.io/${randomId}`;
  }

  openChatbot(url: string, chatbotName: string) {
    window.open(url, '_blank');

    if (chatbotName !== 'ChatGPT') {
      const promptText = this.extractPromptFromUrl(url);
      navigator.clipboard.writeText(promptText).then(() => {
        this.showCopyMessage(`${chatbotName} prompt copied!`);
      }).catch(() => {
        this.fallbackCopyTextToClipboard(promptText);
        this.showCopyMessage(`${chatbotName} prompt copied!`);
      });
    }
  }

  copyDirectUrl(url: string, chatbotName: string) {
    navigator.clipboard.writeText(url).then(() => {
      this.showCopyMessage(`${chatbotName} URL copied!`);
    }).catch(() => {
      this.fallbackCopyTextToClipboard(url);
      this.showCopyMessage(`${chatbotName} URL copied!`);
    });
  }

  getShortenedUrl(url: string): string {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const searchParams = urlObj.searchParams;

    const prompt = searchParams.get('q') || searchParams.get('prompt') || '';
    const shortenedPrompt = prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt;

    return `${domain}?${shortenedPrompt}`;
  }

  extractPromptFromUrl(url: string): string {
    const urlObj = new URL(url);
    const searchParams = urlObj.searchParams;

    const encodedPrompt = searchParams.get('q') || searchParams.get('prompt') || '';
    return decodeURIComponent(encodedPrompt);
  }

  selectInput(event: Event) {
    const target = event.target as HTMLInputElement | null;
    target?.select();
  }

  resetForm() {
    this.promptForm.reset();
    this.showResults = false;
    this.generatedLinks = [];
    this.characterCount = 0;
  }

  clearForm() {
    this.promptForm.reset();
    this.characterCount = 0;
    // Scroll to form section
    setTimeout(() => {
      const formElement = document.getElementById('signup');
      if (formElement) {
        formElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  }

  hasFormContent(): boolean {
    const name = this.promptForm.get('name')?.value || '';
    const content = this.promptForm.get('content')?.value || '';
    const customUrl = this.promptForm.get('customUrl')?.value || '';
    return name.trim().length > 0 || content.trim().length > 0 || customUrl.trim().length > 0;
  }

  private generateShortenedLinks(promptData: PromptData) {
    this.generatedLinks = [
      {
        name: 'ChatGPT',
        url: this.createChatGPTUrl(promptData.content),
        icon: '🤖',
        color: 'bg-green-600 hover:bg-green-700'
      },
      {
        name: 'Gemini',
        url: this.createGeminiUrl(promptData.content),
        icon: '💎',
        color: 'bg-blue-600 hover:bg-blue-700'
      },
      {
        name: 'Claude',
        url: this.createClaudeUrl(promptData.content),
        icon: '🧠',
        color: 'bg-orange-600 hover:bg-orange-700'
      }
    ];

    this.showResults = true;

    setTimeout(() => {
      const resultsElement = document.getElementById('results');
      if (resultsElement) {
        resultsElement.scrollIntoView({ behavior: 'smooth' });
      }
    }, 100);
  }

  private createChatGPTUrl(prompt: string): string {
    const encodedPrompt = encodeURIComponent(prompt);
    const timestamp = Date.now();
    return `https://chat.openai.com/?q=${encodedPrompt}&t=${timestamp}`;
  }

  private createGeminiUrl(prompt: string): string {
    // Gemini doesn't support URL parameters, so we just return the base URL
    // The prompt will be copied to clipboard before opening
    return 'https://gemini.google.com/app';
  }

  private createClaudeUrl(prompt: string): string {
    const encodedPrompt = encodeURIComponent(prompt);
    return `https://claude.ai/?prompt=${encodedPrompt}`;
  }

  private showCopyMessage(messageText: string) {
    const message = document.createElement('div');
    message.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 transition-all';
    message.textContent = messageText;

    document.body.appendChild(message);

    setTimeout(() => {
      message.remove();
    }, 3000);
  }

  private fallbackCopyTextToClipboard(text: string) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }

  private setupSmoothScrolling() {
    const navLinks = document.querySelectorAll('a[href^="#"]');

    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();

        const targetId = link.getAttribute('href');
        if (!targetId) {
          return;
        }
        const targetElement = document.querySelector(targetId) as HTMLElement | null;

        if (targetElement) {
          const offsetTop = targetElement.offsetTop - 20;

          window.scrollTo({
            top: offsetTop,
            behavior: 'smooth'
          });
        }
      });
    });
  }
}
