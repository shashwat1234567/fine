class VoiceSynthesizer {
  private isPlaying: boolean = false;
  private voices: SpeechSynthesisVoice[] = [];
  private preferredVoices: Map<string, SpeechSynthesisVoice> = new Map();
  private lastUnknownGreeting: Map<string, number> = new Map(); // Track unknown greetings

  constructor() {
    // Initialize voices
    this.loadVoices();
    window.speechSynthesis.onvoiceschanged = () => {
      this.loadVoices();
    };
  }

  private loadVoices() {
    this.voices = window.speechSynthesis.getVoices();
    
    // Find and cache the best voices
    for (const voice of this.voices) {
      const voiceName = voice.name.toLowerCase();
      
      // Prefer Google voices first, then Microsoft, then Apple
      if (voiceName.includes('google') || voiceName.includes('microsoft') || voiceName.includes('samantha')) {
        if (voiceName.includes('female') && !this.preferredVoices.has('female')) {
          this.preferredVoices.set('female', voice);
        } else if ((voiceName.includes('male') || voiceName.includes('david')) && !this.preferredVoices.has('male')) {
          this.preferredVoices.set('male', voice);
        }
      }
    }
  }

  private getPreferredVoice(gender?: string): SpeechSynthesisVoice | null {
    if (gender) {
      const genderKey = gender.toLowerCase();
      if (this.preferredVoices.has(genderKey)) {
        return this.preferredVoices.get(genderKey)!;
      }
    }

    // Fallback to any available voice
    return this.voices.find(voice => voice.lang === 'en-US') || this.voices[0];
  }

  private async speakWithPause(text: string, gender?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Cancel any ongoing speech
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        const voice = this.getPreferredVoice(gender);
        
        if (voice) {
          utterance.voice = voice;
        }

        // Optimize speech parameters for more natural sound
        utterance.rate = 0.9; // Slightly slower for clarity
        utterance.pitch = gender?.toLowerCase() === 'female' ? 1.1 : 0.9;
        utterance.volume = 1.0;

        utterance.onend = () => {
          setTimeout(resolve, 300); // Add small pause between phrases
        };
        utterance.onerror = reject;

        window.speechSynthesis.speak(utterance);
      } catch (error) {
        reject(error);
      }
    });
  }

  async speak(text: string, type: 'staff' | 'customer' | 'unknown', gender?: string): Promise<void> {
    if (this.isPlaying) return;

    try {
      // For unknown visitors, check if we should play the greeting
      if (type === 'unknown' && text) {
        const now = Date.now();
        const key = `${gender || 'unknown'}-${text}`;
        const lastGreeting = this.lastUnknownGreeting.get(key) || 0;

        // Only play greeting if it's been more than 2 seconds since the last one
        if (now - lastGreeting < 2000) {
          return;
        }

        this.lastUnknownGreeting.set(key, now);
        
        // Clean up old greetings (older than 10 seconds)
        for (const [storedKey, timestamp] of this.lastUnknownGreeting) {
          if (now - timestamp > 10000) {
            this.lastUnknownGreeting.delete(storedKey);
          }
        }
      }

      this.isPlaying = true;
      await this.speakWithPause(text, gender);
    } catch (error) {
      console.error('Speech synthesis failed:', error);
    } finally {
      this.isPlaying = false;
    }
  }

  close() {
    window.speechSynthesis.cancel();
    this.isPlaying = false;
  }
}

export default VoiceSynthesizer;