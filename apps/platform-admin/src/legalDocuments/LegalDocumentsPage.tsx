import React, { useState } from 'react';
import { Badge, Button, Card, ErrorBanner, Field, PageHeader, SelectField, Spinner, SuccessBanner, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { LEGAL_DOCUMENT_SLUGS, useLegalDocument, usePublishLegalDocument } from './legalDocumentQueries';

/**
 * Decision 171 — publishing a new version of a legal document. Each publish keeps
 * the previous versions and moves the current version number on. Publishing a new
 * privacy notice means every Guardian's existing consent is now on an older
 * version, and new consent must name the new one. The text itself must come from
 * counsel; this screen only publishes it. FULL_ADMIN-only server-side, like
 * Translations (the nav isn't role-gated client-side).
 */
export function LegalDocumentsPage() {
  const [slug, setSlug] = useState<string>(LEGAL_DOCUMENT_SLUGS[0].slug);
  const current = useLegalDocument(slug);
  const publish = usePublishLegalDocument(slug);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [published, setPublished] = useState<string | null>(null);

  function selectDocument(next: string) {
    setSlug(next);
    setTitle('');
    setContent('');
    setFormError(null);
    setPublished(null);
  }

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setPublished(null);
    if (!content.trim()) {
      setFormError('Paste the full text of the new version.');
      return;
    }
    const nextVersion = (current.data?.currentVersion ?? 0) + 1;
    if (!window.confirm(`Publish version ${nextVersion} of "${slug}"? It replaces the current text for everyone, and cannot be undone.`)) {
      return;
    }
    try {
      const result = await publish.mutateAsync({ content, title: title.trim() || undefined });
      setPublished(`Published ${result.policyVersion}.`);
      setTitle('');
      setContent('');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not publish this version.');
    }
  }

  return (
    <>
      <PageHeader title="Legal documents" subtitle="Publish new versions of the privacy notice and terms. Every version is kept." />

      <Card className="ultm8-field">
        <Field label="Document" htmlFor="legal-document">
          <SelectField
            id="legal-document"
            value={slug}
            onChange={(e) => selectDocument(e.target.value)}
            options={LEGAL_DOCUMENT_SLUGS.map((d) => ({ value: d.slug, label: d.label }))}
          />
        </Field>
        {current.isLoading ? (
          <Spinner />
        ) : current.error ? (
          <ErrorBanner message={current.error instanceof ApiError ? current.error.message : 'Could not load this document.'} />
        ) : current.data ? (
          <>
            <p>
              <strong>{current.data.title}</strong>{' '}
              {current.data.currentVersion ? (
                <Badge variant="success">Version {current.data.currentVersion}</Badge>
              ) : (
                <Badge variant="danger">Not published</Badge>
              )}
            </p>
            {current.data.content ? (
              <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}>{current.data.content}</pre>
            ) : (
              <p>
                <small>
                  No text yet.
                  {slug === 'privacy-statement' ? ' Guardians cannot give consent until a privacy notice is published.' : ''}
                </small>
              </p>
            )}
          </>
        ) : null}
      </Card>

      <Card>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
          Publish a new version
        </h2>
        {published ? <SuccessBanner message={published} /> : null}
        {formError ? <ErrorBanner message={formError} /> : null}
        <form onSubmit={handlePublish}>
          <Field label="Title" htmlFor="legal-title" hint="Leave empty to keep the current title.">
            <TextField id="legal-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </Field>
          <Field label="Full text" htmlFor="legal-content" hint="Use the exact text approved by counsel.">
            <TextArea id="legal-content" rows={14} value={content} onChange={(e) => setContent(e.target.value)} />
          </Field>
          <Button type="submit" loading={publish.isPending}>
            Publish version {(current.data?.currentVersion ?? 0) + 1}
          </Button>
        </form>
      </Card>
    </>
  );
}
