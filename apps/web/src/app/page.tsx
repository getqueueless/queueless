import Image from "next/image"
import Link from "next/link"

import { LogoMark } from "@/components/brand/Logo"
import { AnimatedHeading } from "@/components/motion/AnimatedHeading"
import { RolodexWord } from "@/components/motion/RolodexWord"
import { PublicFooter } from "@/components/site/PublicFooter"
import { PublicHeader } from "@/components/site/PublicHeader"
import { createClient } from "@/lib/supabase/server"

import corridor from "../../public/images/opd-corridor.jpg"
import { loadBoard } from "./_landing/board"
import { ExampleSlip } from "./_landing/ExampleSlip"
import { LiveStats } from "./_landing/LiveStats"
import { MobileCta } from "./_landing/MobileCta"
import { StatusLookup } from "./_landing/StatusLookup"
import styles from "./page.module.css"

const STEPS = [
  {
    title: "Take a token",
    text: "Book one on your phone after signing in, or pick up a slip at the reception desk.",
    icon: (
      <>
        <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z" />
        <path d="M15 5v2m0 3v2m0 3v2" />
      </>
    ),
  },
  {
    title: "Wait anywhere",
    text: "Your place is held, not your seat. Sit anywhere, step out for tea, keep your phone on you.",
    icon: (
      <>
        <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
  },
  {
    title: "Get called",
    text: "Your status page updates live, and the waiting-room TV shows which counter to go to.",
    icon: (
      <>
        <path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15Z" />
        <path d="M10 20.5a2 2 0 0 0 4 0" />
      </>
    ),
  },
]

export default async function Home() {
  const supabase = await createClient()

  // Same query /kiosk uses to list services. `services` is readable by anon
  // (supabase/migrations/0030_rls_public_tables.sql), so no session needed.
  const [{ data: services, error: servicesError }, board] = await Promise.all([
    supabase.from("services").select("id, name, code").eq("is_open", true).order("name"),
    loadBoard(supabase),
  ])

  return (
    <>
      <div className={styles.headerOverlay}>
        <PublicHeader current="home" tone="slate" />
      </div>

      <main id="main" className={styles.main}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <Image
            src={corridor}
            alt=""
            fill
            preload
            sizes="100vw"
            placeholder="blur"
            className={styles.heroImage}
          />
          <div className={styles.heroShade} aria-hidden="true" />
          <div className={styles.heroInner}>
            <h1 id="hero-title" className={styles.heroTitle}>
              Skip the{" "}
              <RolodexWord
                words={["line.", "wait.", "crowd.", "queue."]}
                hold={1200}
                className={styles.heroAccent}
              />
            </h1>
            <p className={styles.heroLead}>
              Your place in the queue is held. Wait wherever you like, and your phone shows when
              the counter is ready.
            </p>
            {/* Patients take a token from /my; /login sends them straight there. */}
            <div id="hero-ctas" className={styles.heroCtas}>
              <Link href="/login?next=/my" className={`${styles.btn} ${styles.btnAccent}`}>
                Take a token
              </Link>
              <a href="#status" className={`${styles.btn} ${styles.btnGhost}`}>
                Check status
              </a>
            </div>
          </div>
        </section>

        <div className={styles.container}>
          <section id="status" aria-labelledby="status-title" className={styles.lookupCard}>
            <div className={styles.lookupMain}>
              <AnimatedHeading as="h2" id="status-title" lead="Check your" accent="status" />
              <p className={styles.lookupIntro}>
                Scan the QR on your slip with your phone camera. Can’t scan it? Type the link
                printed under it to see how many people are ahead of you.
              </p>
              <StatusLookup />
              <p className={styles.appNote}>
                <span className={styles.appIcon} aria-hidden="true">
                  <LogoMark size={16} />
                </span>
                <span>
                  <strong>Queueless for Android</strong> is coming soon. Until then, your slip’s
                  link opens in any phone browser, with nothing to install.
                </span>
              </p>
            </div>

            <ExampleSlip />
          </section>

          <LiveStats initial={board?.stats ?? null} />

          <section aria-labelledby="services-title" className={styles.services}>
            <AnimatedHeading as="h2" id="services-title" lead="Services" accent="open today" align="center" />
            <p className={styles.sectionIntro}>
              Each service keeps its own line. Tokens start with the service code, so you always
              know which board to watch.
            </p>

            {servicesError || !services || services.length === 0 ? (
              <p className={styles.empty}>
                {servicesError
                  ? "Couldn't load services right now. "
                  : "No services are open right now. "}
                <Link href="/">Refresh</Link> to try again.
              </p>
            ) : (
              <ol className={styles.serviceGrid}>
                {services.map((service, i) => {
                  const avgSecs = board?.avgSecsByService[service.id]
                  const waiting = board ? (board.waitingByService[service.id] ?? 0) : null
                  return (
                    <li key={service.id} className={styles.serviceCard}>
                      <span className={styles.numeral} aria-hidden="true">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <h3 className={styles.serviceName}>{service.name}</h3>
                      <p className={styles.serviceMeta}>
                        <span className={styles.code} translate="no">
                          {service.code}
                        </span>
                        {avgSecs ? <>About {Math.max(1, Math.round(avgSecs / 60))} min a visit</> : "Tokens open"}
                      </p>
                      {waiting !== null && (
                        <p className={styles.serviceWaiting}>
                          {waiting > 0 ? (
                            <>
                              <strong>{waiting}</strong> waiting now
                            </>
                          ) : (
                            "No one waiting"
                          )}
                        </p>
                      )}
                      <Link
                        href={`/display/${service.id}`}
                        aria-label={`Live board for ${service.name}`}
                        className={`${styles.btn} ${styles.btnOutline}`}
                      >
                        Live board
                      </Link>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        </div>

        <section id="how" aria-labelledby="how-title" className={styles.how}>
          <span className={styles.howMark} aria-hidden="true">
            <LogoMark size={360} />
          </span>
          <div className={styles.howInner}>
            <AnimatedHeading as="h2" id="how-title" lead="How it" accent="works" onDark align="center" />
            <p className={styles.howIntro}>Three steps, and the middle one is the point.</p>
            <ol className={styles.steps}>
              {STEPS.map((step) => (
                <li key={step.title} className={styles.step}>
                  <span className={styles.stepIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="34" height="34">
                      {step.icon}
                    </svg>
                  </span>
                  <h3 className={styles.stepTitle}>{step.title}</h3>
                  <p className={styles.stepText}>{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <div className={styles.footerTargets}>
        <PublicFooter
          credit={
            <>
              Photo by{" "}
              <a href="https://www.pexels.com/@jinshu-pulpatta-2151876856/">Jinshu Pulpatta</a> on{" "}
              <a href="https://www.pexels.com/photo/modern-hospital-corridor-with-empty-chairs-33812023/">
                Pexels
              </a>
            </>
          }
        />
      </div>
      <MobileCta watch="hero-ctas" />
    </>
  )
}
