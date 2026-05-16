import React, { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { CheckCircle, Mail, MessageSquare, ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { supportAPI } from '../../services/api/support';

const CATEGORIES = [
  { value: 'general', label: 'General Inquiry' },
  { value: 'booking', label: 'Booking Help' },
  { value: 'payment', label: 'Payment Issue' },
  { value: 'listing', label: 'Listing Question' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'other', label: 'Other' },
];

interface FormState {
  name: string;
  email: string;
  category: string;
  subject: string;
  message: string;
}

const INITIAL_FORM: FormState = {
  name: '',
  email: '',
  category: '',
  subject: '',
  message: '',
};

export function Contact() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<Partial<FormState>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedSubject, setSubmittedSubject] = useState('');

  const set = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const validate = (): boolean => {
    const errs: Partial<FormState> = {};
    if (!form.name.trim()) errs.name = 'Name is required';
    if (!form.email.trim()) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      errs.email = 'Enter a valid email address';
    if (!form.category) errs.category = 'Please select a category';
    if (!form.subject.trim()) errs.subject = 'Subject is required';
    if (!form.message.trim()) errs.message = 'Message is required';
    else if (form.message.trim().length < 20)
      errs.message = 'Message must be at least 20 characters';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await supportAPI.submitContact({
        name: form.name.trim(),
        email: form.email.trim(),
        category: form.category,
        subject: form.subject.trim(),
        message: form.message.trim(),
      });
      setSubmittedSubject(form.subject.trim());
      setSubmitted(true);
      setForm(INITIAL_FORM);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send message. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="bg-primary py-16 px-4 text-center">
        <div className="flex justify-center mb-4">
          <div className="bg-white/10 rounded-full p-4">
            <Mail className="w-8 h-8 text-white" />
          </div>
        </div>
        <h1 className="text-4xl font-semibold text-white mb-3">Get in touch</h1>
        <p className="text-white/80 text-lg max-w-md mx-auto">
          Have a question or need help? Send us a message and we'll get back to you within 24 hours.
        </p>
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-12 max-w-2xl">
        {submitted ? (
          /* Thank-you state */
          <div className="bg-card border border-border rounded-xl p-10 text-center shadow-sm">
            <div className="flex justify-center mb-5">
              <CheckCircle className="w-16 h-16 text-green-500" />
            </div>
            <h2 className="text-2xl font-semibold mb-2">Message sent!</h2>
            <p className="text-muted-foreground mb-1">
              Thanks for reaching out about:
            </p>
            <p className="font-medium text-foreground mb-6">"{submittedSubject}"</p>
            <p className="text-sm text-muted-foreground mb-8">
              Our team will review your inquiry and respond to your email within 24 hours.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button variant="outline" onClick={() => setSubmitted(false)}>
                Send another message
              </Button>
              <Button asChild>
                <Link to="/support">
                  Create a support ticket
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          /* Contact form */
          <div className="bg-card border border-border rounded-xl shadow-sm p-8">
            <div className="flex items-center gap-3 mb-6">
              <MessageSquare className="w-5 h-5 text-primary" />
              <h2 className="text-xl font-semibold">Send us a message</h2>
            </div>

            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Name */}
                <div className="space-y-1.5">
                  <Label htmlFor="contact-name">
                    Full name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="contact-name"
                    placeholder="Your name"
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                    className={errors.name ? 'border-destructive' : ''}
                  />
                  {errors.name && (
                    <p className="text-xs text-destructive">{errors.name}</p>
                  )}
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <Label htmlFor="contact-email">
                    Email address <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="contact-email"
                    type="email"
                    placeholder="you@example.com"
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    className={errors.email ? 'border-destructive' : ''}
                  />
                  {errors.email && (
                    <p className="text-xs text-destructive">{errors.email}</p>
                  )}
                </div>
              </div>

              {/* Category */}
              <div className="space-y-1.5">
                <Label htmlFor="contact-category">
                  Category <span className="text-destructive">*</span>
                </Label>
                <Select value={form.category} onValueChange={(v) => set('category', v)}>
                  <SelectTrigger
                    id="contact-category"
                    className={errors.category ? 'border-destructive' : ''}
                  >
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.category && (
                  <p className="text-xs text-destructive">{errors.category}</p>
                )}
              </div>

              {/* Subject */}
              <div className="space-y-1.5">
                <Label htmlFor="contact-subject">
                  Subject <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="contact-subject"
                  placeholder="Brief description of your inquiry"
                  value={form.subject}
                  onChange={(e) => set('subject', e.target.value)}
                  className={errors.subject ? 'border-destructive' : ''}
                />
                {errors.subject && (
                  <p className="text-xs text-destructive">{errors.subject}</p>
                )}
              </div>

              {/* Message */}
              <div className="space-y-1.5">
                <Label htmlFor="contact-message">
                  Message <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="contact-message"
                  placeholder="Tell us how we can help you... (minimum 20 characters)"
                  rows={6}
                  value={form.message}
                  onChange={(e) => set('message', e.target.value)}
                  className={errors.message ? 'border-destructive' : ''}
                />
                <div className="flex justify-between items-center">
                  {errors.message ? (
                    <p className="text-xs text-destructive">{errors.message}</p>
                  ) : (
                    <span />
                  )}
                  <p className="text-xs text-muted-foreground">
                    {form.message.length} chars
                  </p>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={submitting} size="lg">
                {submitting ? 'Sending...' : 'Send message'}
              </Button>
            </form>
          </div>
        )}

        {/* CTA to support tickets */}
        <div className="mt-6 text-center">
          <p className="text-sm text-muted-foreground">
            Need immediate help?{' '}
            <Link to="/support" className="text-primary font-medium hover:underline">
              Create a support ticket
            </Link>{' '}
            and track its progress in real time.
          </p>
        </div>
      </div>
    </div>
  );
}
