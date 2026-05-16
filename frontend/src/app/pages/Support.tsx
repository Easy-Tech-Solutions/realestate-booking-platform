import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  Upload,
  X,
  Search,
  ChevronRight,
  CheckCircle,
  Loader2,
  TicketIcon,
  ArrowLeft,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { useApp } from '../../hooks/useApp';
import { supportAPI, type SearchResult } from '../../services/api/support';

// ── Category data ──────────────────────────────────────────────────────────────

interface Category {
  id: string;
  icon: string;
  title: string;
  description: string;
}

const CATEGORIES: Category[] = [
  { id: 'account', icon: '👤', title: 'Account & Profile', description: 'Login issues, profile updates, verification' },
  { id: 'booking', icon: '📅', title: 'Booking Issue', description: "Can't book, booking errors, host problems" },
  { id: 'payment', icon: '💳', title: 'Payment & Refunds', description: 'Charges, refunds, payment methods' },
  { id: 'listing', icon: '🏠', title: 'Listing Problem', description: 'Inaccurate listing, missing amenities' },
  { id: 'safety', icon: '🔒', title: 'Safety Concern', description: 'Feeling unsafe, fraudulent listings' },
  { id: 'technical', icon: '⚙️', title: 'Technical Issue', description: 'App not working, bugs, errors' },
  { id: 'host', icon: '🏨', title: 'Host Support', description: 'Managing listings, payouts, hosting tools' },
  { id: 'other', icon: '❓', title: 'Other', description: 'Something else' },
];

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEPS = ['Category', 'Search', 'Submit'];

function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-10">
      {STEPS.map((label, i) => {
        const stepNum = i + 1;
        const isDone = stepNum < current;
        const isActive = stepNum === current;
        return (
          <React.Fragment key={label}>
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                  isDone
                    ? 'bg-primary text-primary-foreground'
                    : isActive
                    ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {isDone ? <CheckCircle className="w-4 h-4" /> : stepNum}
              </div>
              <span
                className={`text-xs mt-1.5 font-medium ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`h-px w-12 sm:w-20 mx-1 mt-[-14px] transition-colors ${
                  stepNum < current ? 'bg-primary' : 'bg-border'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── File preview item ──────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function Support() {
  const navigate = useNavigate();
  const { isAuthenticated } = useApp();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [category, setCategory] = useState<Category | null>(null);

  // Step 2
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 3
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [ticketNumber, setTicketNumber] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounced search
  useEffect(() => {
    if (step !== 2) return;
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await supportAPI.searchTickets(searchQuery.trim());
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 400);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery, step]);

  const handleSelectCategory = (cat: Category) => {
    setCategory(cat);
    setStep(2);
  };

  const handleProceedToForm = () => {
    setSubject(searchQuery);
    setStep(3);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...selected.filter((f) => !existing.has(f.name + f.size))];
    });
    e.target.value = '';
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!subject.trim()) errs.subject = 'Subject is required';
    if (!description.trim()) errs.description = 'Description is required';
    else if (description.trim().length < 20)
      errs.description = 'Description must be at least 20 characters';
    if (!isAuthenticated) {
      if (!guestName.trim()) errs.guestName = 'Name is required';
      if (!guestEmail.trim()) errs.guestEmail = 'Email is required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail))
        errs.guestEmail = 'Enter a valid email address';
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('category', category?.id ?? 'other');
      fd.append('subject', subject.trim());
      fd.append('description', description.trim());
      if (!isAuthenticated) {
        fd.append('requester_name', guestName.trim());
        fd.append('requester_email', guestEmail.trim());
      }
      files.forEach((f) => fd.append('attachments', f));

      const ticket = isAuthenticated
        ? await supportAPI.createTicket(fd)
        : await supportAPI.createGuestTicket(fd);

      setTicketNumber(ticket.ticketNumber);
      setSubmitted(true);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit ticket. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="bg-primary py-14 px-4 text-center">
        <div className="flex justify-center mb-4">
          <div className="bg-white/10 rounded-full p-4">
            <TicketIcon className="w-8 h-8 text-white" />
          </div>
        </div>
        <h1 className="text-4xl font-semibold text-white mb-2">How can we help?</h1>
        <p className="text-white/80">
          Tell us what's going on and we'll get it sorted out.
        </p>
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-10 max-w-3xl">
        {submitted ? (
          /* Success state */
          <div className="bg-card border border-border rounded-xl p-10 text-center shadow-sm">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-2xl font-semibold mb-2">Ticket submitted!</h2>
            <p className="text-muted-foreground mb-1">Your ticket number is:</p>
            <p className="font-mono text-lg font-bold text-primary mb-6">{ticketNumber}</p>
            <p className="text-sm text-muted-foreground mb-8">
              We've received your request and will respond as soon as possible. You can
              track progress in your tickets list.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                variant="outline"
                onClick={() => {
                  setSubmitted(false);
                  setStep(1);
                  setCategory(null);
                  setSearchQuery('');
                  setSearchResults([]);
                  setSubject('');
                  setDescription('');
                  setFiles([]);
                  setGuestName('');
                  setGuestEmail('');
                  setTicketNumber('');
                }}
              >
                Create another ticket
              </Button>
              {isAuthenticated && (
                <Button onClick={() => navigate('/support/tickets')}>
                  View my tickets
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <StepIndicator current={step} />

            {/* Step 1 — Choose Category */}
            {step === 1 && (
              <div>
                <h2 className="text-2xl font-semibold text-center mb-6">
                  What do you need help with?
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => handleSelectCategory(cat)}
                      className="bg-card border border-border rounded-xl p-5 text-left hover:border-primary hover:shadow-md transition-all group focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                    >
                      <span className="text-3xl mb-3 block">{cat.icon}</span>
                      <p className="font-semibold text-sm mb-1 group-hover:text-primary transition-colors">
                        {cat.title}
                      </p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {cat.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 2 — Search */}
            {step === 2 && category && (
              <div>
                <button
                  onClick={() => setStep(1)}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to categories
                </button>

                <div className="flex items-center gap-2 mb-6">
                  <span className="text-2xl">{category.icon}</span>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                      Selected category
                    </p>
                    <p className="font-semibold">{category.title}</p>
                  </div>
                </div>

                <h2 className="text-xl font-semibold mb-4">
                  Search for related issues
                </h2>
                <p className="text-sm text-muted-foreground mb-4">
                  We'll check if your issue has already been resolved. You can still
                  create a ticket if you don't find what you need.
                </p>

                <div className="relative mb-6">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Describe your issue briefly..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-11 h-12"
                    autoFocus
                  />
                  {searchLoading && (
                    <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
                  )}
                </div>

                {/* Search results */}
                {searchQuery.trim() && !searchLoading && (
                  <div className="mb-6">
                    {searchResults.length > 0 ? (
                      <div className="space-y-3">
                        <p className="text-sm font-medium text-muted-foreground">
                          {searchResults.length} resolved issue
                          {searchResults.length !== 1 ? 's' : ''} found:
                        </p>
                        {searchResults.map((result) => (
                          <div
                            key={result.id}
                            className="bg-card border border-border rounded-xl p-4 flex items-start gap-3"
                          >
                            <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <Badge variant="secondary" className="text-xs font-mono">
                                  {result.ticketNumber}
                                </Badge>
                                <Badge variant="outline" className="text-xs capitalize">
                                  {result.category}
                                </Badge>
                              </div>
                              <p className="text-sm font-medium truncate">{result.subject}</p>
                              <p className="text-xs text-green-600 mt-0.5">
                                This issue has been resolved
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="bg-muted/40 border border-border rounded-xl p-6 text-center">
                        <p className="text-sm text-muted-foreground mb-3">
                          No resolved issues match your search.
                        </p>
                        <Button onClick={handleProceedToForm} size="sm">
                          Continue creating ticket
                          <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <Button
                  onClick={handleProceedToForm}
                  variant={searchResults.length > 0 ? 'outline' : 'default'}
                  className="w-full"
                  size="lg"
                >
                  My issue is different — create ticket
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            )}

            {/* Step 3 — Form */}
            {step === 3 && category && (
              <div>
                <button
                  onClick={() => setStep(2)}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to search
                </button>

                <div className="flex items-center gap-2 mb-6">
                  <span className="text-2xl">{category.icon}</span>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                      Category
                    </p>
                    <p className="font-semibold">{category.title}</p>
                  </div>
                </div>

                <h2 className="text-xl font-semibold mb-6">Tell us more</h2>

                <form onSubmit={handleSubmit} noValidate className="space-y-5">
                  {/* Guest fields */}
                  {!isAuthenticated && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-4 bg-muted/40 border border-border rounded-xl">
                      <p className="sm:col-span-2 text-sm text-muted-foreground font-medium -mb-1">
                        Your contact information
                      </p>
                      <div className="space-y-1.5">
                        <Label htmlFor="guest-name">
                          Name <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="guest-name"
                          placeholder="Your full name"
                          value={guestName}
                          onChange={(e) => {
                            setGuestName(e.target.value);
                            setFormErrors((p) => ({ ...p, guestName: '' }));
                          }}
                          className={formErrors.guestName ? 'border-destructive' : ''}
                        />
                        {formErrors.guestName && (
                          <p className="text-xs text-destructive">{formErrors.guestName}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="guest-email">
                          Email <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="guest-email"
                          type="email"
                          placeholder="you@example.com"
                          value={guestEmail}
                          onChange={(e) => {
                            setGuestEmail(e.target.value);
                            setFormErrors((p) => ({ ...p, guestEmail: '' }));
                          }}
                          className={formErrors.guestEmail ? 'border-destructive' : ''}
                        />
                        {formErrors.guestEmail && (
                          <p className="text-xs text-destructive">{formErrors.guestEmail}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Subject */}
                  <div className="space-y-1.5">
                    <Label htmlFor="ticket-subject">
                      Subject <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="ticket-subject"
                      placeholder="Brief summary of your issue"
                      value={subject}
                      onChange={(e) => {
                        setSubject(e.target.value);
                        setFormErrors((p) => ({ ...p, subject: '' }));
                      }}
                      className={formErrors.subject ? 'border-destructive' : ''}
                    />
                    {formErrors.subject && (
                      <p className="text-xs text-destructive">{formErrors.subject}</p>
                    )}
                  </div>

                  {/* Description */}
                  <div className="space-y-1.5">
                    <Label htmlFor="ticket-description">
                      Description <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      id="ticket-description"
                      placeholder="Please describe your issue in detail. Include any relevant information such as booking IDs, dates, or error messages. (minimum 20 characters)"
                      rows={6}
                      value={description}
                      onChange={(e) => {
                        setDescription(e.target.value);
                        setFormErrors((p) => ({ ...p, description: '' }));
                      }}
                      className={formErrors.description ? 'border-destructive' : ''}
                    />
                    <div className="flex justify-between">
                      {formErrors.description ? (
                        <p className="text-xs text-destructive">{formErrors.description}</p>
                      ) : (
                        <span />
                      )}
                      <p className="text-xs text-muted-foreground">
                        {description.length} chars
                      </p>
                    </div>
                  </div>

                  {/* File upload */}
                  <div className="space-y-2">
                    <Label>Attachments (optional)</Label>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary hover:bg-primary/5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                    >
                      <Upload className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm font-medium">Attach evidence</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Screenshots, documents, or any relevant files
                      </p>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    {files.length > 0 && (
                      <div className="space-y-2 mt-2">
                        {files.map((file, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-3 bg-muted/40 border border-border rounded-lg px-4 py-2.5"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{file.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatBytes(file.size)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeFile(i)}
                              className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                              aria-label={`Remove ${file.name}`}
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    size="lg"
                    disabled={submitting}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      'Submit ticket'
                    )}
                  </Button>
                </form>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
