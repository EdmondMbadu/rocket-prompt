import { Component, signal, AfterViewInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

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
  selector: 'app-root',
  imports: [RouterOutlet, ReactiveFormsModule, CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements AfterViewInit {
  protected readonly title = signal('rocket-prompt');

  promptForm: FormGroup;
  generatedLinks: ChatbotLink[] = [];
  showResults = false;
  characterCount = 0;

  constructor(private fb: FormBuilder) {
    this.promptForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(3)]],
      content: ['', [Validators.required, Validators.minLength(10)]],
      customUrl: ['']
    });

    // Watch for content changes to update character count
    this.promptForm.get('content')?.valueChanges.subscribe(value => {
      this.characterCount = value?.length || 0;
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

  private generateShortenedLinks(promptData: PromptData) {
    // Generate a short URL (for now, we'll use a simple hash)
    const shortUrl = this.generateShortUrl(promptData.customUrl || promptData.name);

    // Create chatbot links with the prompt pre-filled
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

    // Scroll to results
    setTimeout(() => {
      const resultsElement = document.getElementById('results');
      if (resultsElement) {
        resultsElement.scrollIntoView({ behavior: 'smooth' });
      }
    }, 100);
  }

  generateShortUrl(customUrl?: string): string {
    if (customUrl) {
      return `rocketprompt.io/${customUrl}`;
    }

    // Generate a random short URL
    const randomId = Math.random().toString(36).substring(2, 8);
    return `rocketprompt.io/${randomId}`;
  }

  private createChatGPTUrl(prompt: string): string {
    // ChatGPT doesn't have a direct URL parameter for prompts, but we can use the web interface
    const encodedPrompt = encodeURIComponent(prompt);
    const timestamp = Date.now(); // Add timestamp to prevent caching
    return `https://chat.openai.com/?q=${encodedPrompt}&t=${timestamp}`;
  }

  private createGeminiUrl(prompt: string): string {
    // Gemini URL with prompt parameter
    const encodedPrompt = encodeURIComponent(prompt);
    return `https://gemini.google.com/app?prompt=${encodedPrompt}`;
  }

  private createClaudeUrl(prompt: string): string {
    // Claude URL with prompt parameter
    const encodedPrompt = encodeURIComponent(prompt);
    return `https://claude.ai/?prompt=${encodedPrompt}`;
  }

  openChatbot(url: string, chatbotName: string) {
    // Always open in new tab
    window.open(url, '_blank');

    // For Claude and Gemini, also copy URL to clipboard since they don't auto-fill
    if (chatbotName !== 'ChatGPT') {
      navigator.clipboard.writeText(url).then(() => {
        this.showCopyMessage(chatbotName);
      }).catch(() => {
        // Fallback for older browsers
        this.fallbackCopyTextToClipboard(url);
        this.showCopyMessage(chatbotName);
      });
    }
  }

  private showCopyMessage(chatbotName: string) {
    // Create a temporary success message
    const message = document.createElement('div');
    message.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 transition-all';
    message.textContent = `${chatbotName} URL copied! Paste with Cmd+V`;

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

  resetForm() {
    this.promptForm.reset();
    this.showResults = false;
    this.generatedLinks = [];
    this.characterCount = 0;
  }

  private setupSmoothScrolling() {
    const navLinks = document.querySelectorAll('a[href^="#"]');

    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();

        const targetId = link.getAttribute('href');
        const targetElement = document.querySelector(targetId!) as HTMLElement;

        if (targetElement) {
          const offsetTop = targetElement.offsetTop - 20; // Account for fixed header

          window.scrollTo({
            top: offsetTop,
            behavior: 'smooth'
          });
        }
      });
    });
  }
}
