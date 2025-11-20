import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { take } from 'rxjs/operators';
import { BillingService } from '../../services/billing.service';

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
  readonly processingPlan = signal<'plus' | 'team' | null>(null);
  readonly checkoutError = signal<string | null>(null);
  readonly checkoutNotice = signal<{ type: 'success' | 'error'; message: string } | null>(null);

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private billingService: BillingService,
    private route: ActivatedRoute
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

  private hasCheckoutQueryParam = false;

  ngOnInit() {
    this.observeCheckoutStatus();

    // Redirect logged-in users to home page when no checkout status to show
    this.authService.currentUser$.pipe(take(1)).subscribe(user => {
      if (user && user.emailVerified) {
        if (!this.hasCheckoutQueryParam) {
          this.router.navigate(['/home']);
        }
      }
    });
  }

  ngAfterViewInit() {
    this.setupSmoothScrolling();
  }

  async startCheckout(plan: 'plus' | 'team') {
    const user = this.authService.currentUser;
    if (!user) {
      await this.router.navigate(['/auth'], {
        queryParams: {
          mode: 'login',
          redirectTo: `/pricing?plan=${plan}&autoCheckout=1`
        }
      });
      return;
    }

    this.checkoutError.set(null);
    this.processingPlan.set(plan);

    try {
      await this.billingService.startCheckout(plan);
    } catch (error) {
      console.error('Failed to start checkout', error);
      this.checkoutError.set(this.mapCheckoutError(error));
    } finally {
      this.processingPlan.set(null);
    }
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
    // For Grok, we need to get the prompt from the form since it's not in the URL
    if (url.includes('grok') && !encodedPrompt) {
      return this.promptForm.get('content')?.value || '';
    }
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

  isProcessing(plan: 'plus' | 'team') {
    return this.processingPlan() === plan;
  }

  dismissCheckoutNotice() {
    this.checkoutNotice.set(null);
  }

  private observeCheckoutStatus() {
    const snapshotCheckout = this.route.snapshot.queryParamMap.get('checkout');
    if (snapshotCheckout) {
      this.hasCheckoutQueryParam = true;
    }

    this.route.queryParamMap.pipe(take(1)).subscribe(params => {
      const checkout = params.get('checkout');
      if (!checkout) {
        return;
      }

      const planLabel = this.formatPlanLabel(params.get('plan'));
      if (checkout === 'cancelled') {
        this.checkoutNotice.set({
          type: 'error',
          message: `Checkout was cancelled. ${planLabel} has not been activated.`
        });
      } else if (checkout === 'error') {
        this.checkoutNotice.set({
          type: 'error',
          message: 'We were unable to complete your payment. Please try again or contact support.'
        });
      } else if (checkout === 'success') {
        this.checkoutNotice.set({
          type: 'success',
          message: `${planLabel} is now active.`
        });
      }

      this.hasCheckoutQueryParam = false;
      this.clearCheckoutParams();
    });
  }

  private formatPlanLabel(plan: string | null) {
    if (plan === 'team') {
      return 'Your Pro / Team plan';
    }
    if (plan === 'plus') {
      return 'Your Plus plan';
    }
    return 'Your plan';
  }

  private clearCheckoutParams() {
    void this.router.navigate([], {
      queryParams: { checkout: null, plan: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
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
      },
      {
        name: 'Grok',
        url: this.createGrokUrl(promptData.content),
        icon: '🤖',
        color: 'bg-black hover:bg-gray-800'
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

  private createGrokUrl(prompt: string): string {
    // Grok doesn't support URL parameters, so we just return the base URL
    // The prompt will be copied to clipboard before opening
    return 'https://x.com/i/grok';
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

  private mapCheckoutError(error: unknown): string {
    if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof (error as { message?: unknown }).message === 'string'
    ) {
      const firebaseCode = (error as { code?: unknown }).code;
      if (firebaseCode === 'functions/unauthenticated') {
        return 'Please sign in before upgrading your account.';
      }

      const firebaseMessage = (error as { details?: unknown }).details;
      if (typeof firebaseMessage === 'string' && firebaseMessage.trim()) {
        return firebaseMessage;
      }

      return (error as { message: string }).message;
    }

    return 'We could not start the checkout. Please try again.';
  }
}
