"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"

import { CATEGORIES, HELP_API, parseAsk, type AskResult, type CategoryKey, type FaqItem } from "./help-api"
import styles from "./faq.module.css"

// The site has no language switch yet, so questions go to the assistant in English.
const LANG = "en"

export function FaqClient({ items }: { items: FaqItem[] }) {
  const [category, setCategory] = useState<CategoryKey | "all">("all")
  const [query, setQuery] = useState("")
  const [question, setQuestion] = useState("")
  const [result, setResult] = useState<AskResult | null>(null)
  const [asking, setAsking] = useState(false)
  const [reveal, setReveal] = useState<string | null>(null)

  const present = CATEGORIES.filter((c) => items.some((item) => item.category === c.key))
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(
      (item) =>
        (category === "all" || item.category === category) &&
        (!q || item.question.toLowerCase().includes(q) || item.answer.toLowerCase().includes(q)),
    )
  }, [items, category, query])

  // "Based on" links: clear the filters so the item is in the list, then open and scroll to it.
  useEffect(() => {
    if (!reveal) return
    const el = document.getElementById(`faq-${reveal}`) as HTMLDetailsElement | null
    if (el) {
      el.open = true
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      el.querySelector("summary")?.focus({ preventScroll: true })
    }
  }, [reveal])

  function showSource(source: { id: string; title: string }) {
    const item =
      items.find((i) => i.id === source.id) ??
      items.find((i) => i.question.toLowerCase() === source.title.toLowerCase())
    if (!item) return
    setCategory("all")
    setQuery("")
    setReveal(null)
    requestAnimationFrame(() => setReveal(item.id))
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const q = question.trim()
    if (!q || asking) return
    setAsking(true)
    setResult(null)
    try {
      const res = await fetch(`${HELP_API}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, lang: LANG }),
      })
      setResult(parseAsk(res.status, await res.json().catch(() => null)))
    } catch {
      setResult({ kind: "error" })
    } finally {
      setAsking(false)
    }
  }

  return (
    <>
      <section aria-labelledby="ask-title" className={styles.ask}>
        <h2 id="ask-title" className={styles.askTitle}>
          Ask WaitWise
        </h2>
        <p className={styles.askIntro}>Ask in your own words. Answers come from the questions on this page.</p>
        <form onSubmit={ask} className={styles.askForm}>
          <label htmlFor="ask-input" className={styles.srOnly}>
            Your question
          </label>
          <input
            id="ask-input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={300}
            autoComplete="off"
            enterKeyHint="send"
            placeholder="How do refunds work?"
            className={styles.input}
          />
          <button type="submit" disabled={asking || !question.trim()} className={styles.primary}>
            {asking ? "Asking…" : "Ask"}
          </button>
        </form>
        <div aria-live="polite" aria-busy={asking}>
          {asking && <p className={styles.askNote}>Looking through the answers…</p>}
          {result?.kind === "rate_limited" && (
            <p className={styles.askNote}>Too many questions just now. Try again in a minute, or browse below.</p>
          )}
          {result?.kind === "error" && (
            <p className={styles.askNote}>Couldn’t get an answer right now. The questions below may already cover it.</p>
          )}
          {result?.kind === "answer" && (
            <div className={styles.answer}>
              {result.answer.split(/\n{2,}/).map((para, i) => (
                <p key={i}>{para}</p>
              ))}
              {result.sources.length > 0 && (
                <p className={styles.basedOn}>
                  {result.ai ? "Written by AI from these answers" : "Matched from these answers"}. Based on:{" "}
                  {result.sources.map((s, i) => (
                    <span key={`${s.id}-${i}`}>
                      {i > 0 && ", "}
                      <a href={`#faq-${s.id}`} onClick={(e) => (e.preventDefault(), showSource(s))}>
                        {s.title || s.id}
                      </a>
                    </span>
                  ))}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="browse-title" className={styles.browse}>
        <h2 id="browse-title" className={styles.srOnly}>
          All questions
        </h2>
        <div className={styles.tools}>
          <div role="group" aria-label="Category" className={styles.chips}>
            {[{ key: "all" as const, label: "All" }, ...present].map((c) => (
              <button
                key={c.key}
                type="button"
                aria-pressed={category === c.key}
                onClick={() => setCategory(c.key)}
                className={styles.chip}
              >
                {c.label}
              </button>
            ))}
          </div>
          <label htmlFor="faq-search" className={styles.srOnly}>
            Search questions
          </label>
          <input
            id="faq-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search questions"
            className={styles.input}
          />
        </div>

        {shown.length === 0 ? (
          <p className={styles.none}>No questions match. Try another word, or ask above.</p>
        ) : (
          <div className={styles.list}>
            {shown.map((item) => (
              <details key={item.id} id={`faq-${item.id}`} className={styles.item}>
                <summary className={styles.question}>{item.question}</summary>
                <div className={styles.answerBody}>
                  {item.answer.split(/\n{2,}/).map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
