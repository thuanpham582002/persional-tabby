import { Component, Input, ElementRef, ViewChild, AfterViewInit, OnChanges, SimpleChanges, AfterViewChecked, HostListener } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { HotkeysService, NotificationsService } from 'tabby-core'

/** @hidden */
@Component({
    selector: 'buffer-text-overlay',
    template: `
        <div class="modal-header">
            <h5 class="modal-title">Buffer Text</h5>
            <button type="button" class="btn-close" (click)="close()"></button>
        </div>
        <div class="modal-body">
            <div class="edit-controls mb-2">
                <div class="btn-toolbar" role="toolbar">
                    <div class="btn-group me-2">
                        <button type="button" class="btn btn-sm btn-secondary" 
                            [disabled]="historyIndex <= 0" 
                            (click)="undo()">
                            <i class="fas fa-undo"></i> Undo
                        </button>
                        <button type="button" class="btn btn-sm btn-secondary" 
                            [disabled]="historyIndex >= history.length - 1" 
                            (click)="redo()">
                            <i class="fas fa-redo"></i> Redo
                        </button>
                    </div>
                    <div class="btn-group me-2">
                        <button type="button" class="btn btn-sm btn-secondary" (click)="saveCurrentState()">
                            <i class="fas fa-save"></i> Save State
                        </button>
                    </div>
                    <div class="form-check form-switch ms-auto">
                        <input class="form-check-input" type="checkbox" id="stripAnsi" [(ngModel)]="stripAnsiEnabled" (change)="onStripAnsiToggle()">
                        <label class="form-check-label" for="stripAnsi">
                            Strip ANSI codes
                        </label>
                    </div>
                </div>
            </div>
            <textarea #textArea class="form-control" 
                autofocus 
                [(ngModel)]="displayText" 
                (input)="onTextChanged()" 
                (focus)="pauseHotkeys()"></textarea>
        </div>
        <div class="modal-footer">
            <button type="button" class="btn btn-primary" (click)="copyText()">Copy to Clipboard</button>
            <button type="button" class="btn btn-secondary" (click)="close()">Close</button>
        </div>
    `,
    styles: [`
        textarea {
            width: 100%;
            height: 300px;
            font-family: monospace;
            white-space: pre;
            overflow-wrap: normal;
            overflow-x: scroll;
        }
        .form-check {
            margin-top: 5px;
        }
        .edit-controls {
            border-bottom: 1px solid rgba(128, 128, 128, 0.3);
            padding-bottom: 8px;
        }
    `],
})
export class BufferTextOverlayComponent implements AfterViewInit, OnChanges, AfterViewChecked {
    @Input() text = ''
    plainText = ''
    displayText = ''
    stripAnsiEnabled = true
    @ViewChild('textArea') textAreaRef: ElementRef<HTMLTextAreaElement>
    private scrollAttempts = 0
    private maxScrollAttempts = 5
    private needsScrollToBottom = true
    private hotkeysPaused = false

    // Simple history management
    history: string[] = []
    historyIndex = -1
    private ignoreNextChange = false

    constructor(
        private activeModal: NgbActiveModal,
        private hotkeysService: HotkeysService,
        private notifications: NotificationsService,
    ) { }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes.text) {
            this.updateDisplayText()
            this.needsScrollToBottom = true
            this.resetHistory()
        }
    }

    ngAfterViewInit(): void {
        setTimeout(() => {
            this.updateDisplayText()
            this.scrollToBottom()
            this.pauseHotkeys()
            this.resetHistory()
        }, 100)
    }

    resetHistory(): void {
        this.history = [this.displayText]
        this.historyIndex = 0
    }

    // Handle text changes from user input
    onTextChanged(): void {
        if (this.ignoreNextChange) {
            this.ignoreNextChange = false
            return
        }

        // Add to history
        if (this.historyIndex < this.history.length - 1) {
            // If we're not at the most recent state, truncate the history
            this.history = this.history.slice(0, this.historyIndex + 1)
        }
        
        // Add current state to history
        this.history.push(this.displayText)
        this.historyIndex = this.history.length - 1
        
        // Limit history size
        if (this.history.length > 100) {
            this.history = this.history.slice(-100)
            this.historyIndex = this.history.length - 1
        }
    }

    // Explicitly save current state (useful for major changes)
    saveCurrentState(): void {
        // Don't save if nothing has changed
        if (this.history[this.historyIndex] === this.displayText) {
            return
        }
        
        this.history.push(this.displayText)
        this.historyIndex = this.history.length - 1
        this.notifications.info('State saved')
    }

    // Undo operation
    undo(): void {
        if (this.historyIndex > 0) {
            this.historyIndex--
            this.ignoreNextChange = true
            this.displayText = this.history[this.historyIndex]
            
            // Focus the textarea after state change
            setTimeout(() => {
                if (this.textAreaRef?.nativeElement) {
                    this.textAreaRef.nativeElement.focus()
                }
            }, 0)
            
            this.notifications.info('Undo')
        }
    }

    // Redo operation
    redo(): void {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++
            this.ignoreNextChange = true
            this.displayText = this.history[this.historyIndex]
            
            // Focus the textarea after state change
            setTimeout(() => {
                if (this.textAreaRef?.nativeElement) {
                    this.textAreaRef.nativeElement.focus()
                }
            }, 0)
            
            this.notifications.info('Redo')
        }
    }

    ngAfterViewChecked(): void {
        if (this.needsScrollToBottom && this.scrollAttempts < this.maxScrollAttempts) {
            this.scrollAttempts++;
            setTimeout(() => {
                this.scrollToBottom();
                if (this.scrollAttempts >= this.maxScrollAttempts) {
                    this.needsScrollToBottom = false;
                }
            }, 200);
        }
    }

    /**
     * Pause hotkeys when the overlay is focused
     */
    pauseHotkeys(): void {
        if (!this.hotkeysPaused) {
            this.hotkeysService.disable()
            this.hotkeysPaused = true
        }
    }

    /**
     * Restore hotkeys when the overlay is closed
     */
    resumeHotkeys(): void {
        if (this.hotkeysPaused) {
            this.hotkeysService.enable()
            this.hotkeysPaused = false
        }
    }

    /**
     * Handle escape key to close overlay
     */
    @HostListener('document:keydown.escape')
    onEscapePressed(): void {
        this.close()
    }

    /**
     * Scrolls the textarea to the bottom and places cursor at the end
     */
    scrollToBottom(): void {
        if (this.textAreaRef?.nativeElement) {
            const textarea = this.textAreaRef.nativeElement

            // Use multiple scroll methods for better compatibility
            // 1. Standard method
            textarea.scrollTop = textarea.scrollHeight
            
            // 2. Force the browser to recalculate layout
            textarea.style.height = (textarea.scrollHeight + 1) + 'px'
            textarea.style.height = '300px'
            
            // 3. Scroll with a slight delay to ensure content is rendered
            setTimeout(() => {
                textarea.scrollTop = textarea.scrollHeight
                
                // Finally set focus and cursor position
                textarea.focus()
                textarea.setSelectionRange(textarea.value.length, textarea.value.length)
            }, 50)
        }
    }

    updateDisplayText(): void {
        if (this.stripAnsiEnabled) {
            this.plainText = this.stripANSI(this.text)
            // If stripping made text empty, use original text as fallback
            this.displayText = this.plainText.trim() ? this.plainText : this.text
        } else {
            this.displayText = this.text
        }
    }

    /**
     * Strips ANSI escape sequences from text
     */
    stripANSI(text: string): string {
        if (!text) return ''
        
        // A simpler approach that preserves the actual text content
        // First, replace terminal commands that should be newlines
        let result = text
            // Add proper newline after command sequences like "vi filename"
            .replace(/\$ ([a-z]+) ([^\n]+)([^\n]*)\x1B\[\?1049h/g, '$ $1 $2\n')
            
            // Handle ESC sequences
            .replace(/\x1B\[\?[0-9;]*[a-zA-Z]/g, '')    // Private mode sequences like [?1049h
            .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')     // CSI sequences
            .replace(/\x1B\][^\x07]*\x07/g, '')        // OSC sequences
            .replace(/\x1B[@A-Z\\^_`a-z{|}~]/g, '')    // Other ESC sequences
            
            // Handle terminal control sequences without the ESC prefix
            // These often appear after an ESC sequence was partially stripped
            .replace(/\[[\d;]*[A-Za-z]/g, '')         // Control sequences like [1B, [71D, etc.
            
            // Remove remaining control characters
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        
        // Fix common issues that occur after stripping
        result = result
            // Fix text that was merged due to lost newlines
            .replace(/\$ ([a-z]+) ([^ ]+)([^ ]*)version:/g, '$ $1 $2\nversion:')
            .replace(/([a-z]+)version:/g, '$1\nversion:')
        
        return result
    }

    // Save any user edits before updating the display text
    preserveUserEdits(): string {
        // Store the current edited text if it exists
        return this.textAreaRef?.nativeElement ? this.textAreaRef.nativeElement.value : this.displayText
    }

    selectAllText(): void {
        if (this.textAreaRef?.nativeElement) {
            this.textAreaRef.nativeElement.select()
        }
    }

    async copyText(): Promise<void> {
        // Copy the current text from the textarea (which may include user edits)
        const currentText = this.textAreaRef.nativeElement.value
        await navigator.clipboard.writeText(currentText)
        this.notifications.notice('Copied to clipboard')
    }

    close(): void {
        this.resumeHotkeys()
        this.activeModal.close()
    }

    /**
     * Handle checkbox toggle for ANSI stripping
     */
    onStripAnsiToggle(): void {
        // When toggling, we want to reset to the processed text
        this.updateDisplayText()
        
        // Add this state change to history
        this.history.push(this.displayText)
        this.historyIndex = this.history.length - 1
    }
} 