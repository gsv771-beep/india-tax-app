# Chatbot Corpus — Sources, Licensing, and Ingestion Plan

Compiled 13 September 2026. This is the scoping document for the RAG knowledge base behind your chat box.

---

## 1. The headline findings

Three things matter more than everything else in this document.

**One: incometaxindia.gov.in explicitly allows AI crawlers.** Its `robots.txt` allow-lists `GPTBot`, `OAI-SearchBot`, `ClaudeBot`, `Claude-Web`, `PerplexityBot` and `Google-Extended`, each with an **empty `Disallow`**. `Bytespider` is fully blocked. General crawlers are blocked only from `/group/*`, `/login`, `/user-management/*`, search endpoints and tracking-parameter URLs. Nothing substantive is off-limits, and a sitemap is published at `/sitemap.xml` with 500+ URLs. This is an unusually permissive posture and is the strongest signal you have that crawling is tolerated.

**Two: there is a live, unauthenticated REST API nobody talks about.** The site runs Liferay DXP, and its headless delivery endpoint responds without a key:

```
GET https://www.incometaxindia.gov.in/o/headless-delivery/v1.0/sites/20117/documents?page=1&pageSize=20
```

It returns standard Liferay JSON with `totalCount: 869`, pagination, and per-item `id`, `title`, `contentUrl`, `fileExtension`, `dateCreated`, `dateModified`, `keywords[]` and `taxonomyCategoryBriefs[]`. Caveat, stated plainly: 869 documents is far short of the full circular and notification corpus, and a sample of page 1 returned site assets rather than legal PDFs. Treat it as a useful metadata feed, not the whole corpus. Worth probing next: `/o/headless-delivery/v1.0/sites/20117/structured-contents` and `/content-structures`. The legacy `/api/jsonws` returns 403.

**Three: the official 1961↔2025 section mapping exists, and it is the single highest-leverage asset for your chatbot.** CBDT publishes three comparison utilities:

- Act mapping: `https://www.incometaxindia.gov.in/utility-to-check-provisions-of-income-tax-act-1961-vis-a-vis-income-tax-act-2025`
- Rules mapping: `.../utility-to-check-provisions-of-income-tax-rules-1962-vis-a-vis-income-tax-rules-2026`
- Forms mapping: `.../utility-to-check-forms-under-income-tax-rule-1962-vis-a-vis-income-tax-rules-2026`

**Unresolved and worth ten minutes of your time:** these are JS-rendered, so it could not be confirmed whether the mapping is downloadable in bulk or only queryable one section at a time. Open one in a browser with DevTools, trigger a lookup, and capture the XHR. Given the Liferay stack a backing JSON endpoint is likely — if it exists you can pull all 536 mappings in minutes. If not, 536 scripted lookups is still trivial. Note the mapping is **many-to-many**, not 1:1, so capture full result sets rather than first hits.

---

## 2. Source inventory

### Primary — incometaxindia.gov.in

The site was rebuilt on Liferay; old `/Pages/*.aspx` URLs are gone and now redirect.

| What | URL |
|---|---|
| Act 2025 hub | `/income-tax-act-202511` |
| Act 2025 browse | `/income-tax-act-2025` |
| Rules 2026 | `/income-tax-rule-2026` |
| Circulars | `/circulars` |
| Notifications | `/notifications` |
| Reckoner | `/reckoner` |
| Tax rates | `/tax-rates` |
| Act 2025 consolidated PDF | `/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf` |
| Act 1961 consolidated PDF | `/documents/d/guest/income_tax_act_1961_as_amended_by_fa_act_2026-1-pdf` |

**Section-level HTML is your best ingestion target.** `https://www.incometaxindia.gov.in/w/section-288-55` returns the complete text of s.288 of the 1961 Act as clean HTML — all subsections, the Explanation with its clauses, and 26 footnotes carrying amendment cross-references. Structured, per-section, with amendment history already attached.

The catch: the URL pattern is `/w/section-{number}-{opaque_id}` and the trailing id is not derivable — `section-288-55` and `section-288-53` both exist for different Acts. **Enumerate from the sitemap; do not construct URLs.**

### Official transition documents — short, authoritative, high-value

These answer the questions your users will actually ask in 2026:

- FAQs on Interplay and Transition: `/documents/20117/43120/Updated-FQAs-on-Interplay%26Transitions.pdf`
- FAQs on Transition Provisions under s.536 (Repeals and Savings): `/documents/20117/43120/FAQs-on-Transition-Provisions.pdf`
- Crypto-Asset Reporting Guidance Note under s.509: `/documents/20117/43120/E-Book-Guidance-Note-Crypto-Asset-Reporting-Obligations.pdf`
- Form Mapping Guide (1961→2025): `https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/Guide%20to%20IT%20Act%202025%20forms.pdf`

### Secondary sources

| Source | Use | Notes |
|---|---|---|
| **indiabudget.gov.in** | Finance Bill, and especially the **Memorandum Explaining the Provisions** (`/doc/memo.pdf`) | The memo is the best official plain-language gloss you will get from government. High value for a consumer chatbot. |
| **PIB** | Recency — deadline extensions, clarifications, announcements | RSS feeds at `ViewRss.aspx?reg={n}&lang={n}` are the cleanest incremental-update channel in the whole landscape. Cite, don't treat as authority. |
| **e-Gazette** | Citation anchoring and supersession proof | PDF only, no API, cookies required. Gazette ID pattern `CG-DL-E-{DDMMYYYY}-{NNNNNN}`. Fetch selectively. |
| **India Code** | Cross-check on canonical text | ⚠️ **Migrated from indiacode.nic.in to indiacode.gov.in.** The new domain returned a robots.txt HTTP 500, so its current state is unknown. It historically runs DSpace — **test `/oai/request?verb=Identify`**, because OAI-PMH is the only plausible true bulk-harvest route in this landscape. |
| **ITAT / eSCR** | Case law | `itat.gov.in/judicial/tribunalorders`, `judgments.ecourts.gov.in`. See the recommendation below. |

**Do not confuse `indiacode.ecourtsindia.com` with India Code.** It is a third-party JSON/CSV/Akoma-Ntoso API, it says so itself, and its act coverage does not include income tax. Useless here.

**The ITD e-filing portal's APIs are ERI-only.** The seven published APIs (Login, Add Client, Prefill, Validate & Submit ITR, e-Verify, Acknowledgement) are restricted to approved e-Return Intermediaries. Irrelevant to a corpus; relevant only if you later add filing.

---

## 3. Licensing — the uncomfortable part

**incometaxindia.gov.in carries no open licence.** Its footer reads "© Copyright Income Tax Department, Ministry of Finance, Government of India. All Rights Reserved." Neither the Terms & Conditions page nor the copyright-policy path contains the standard Government of India "may be reproduced free of cost with attribution" clause found on many other GoI sites. No CC licence, no GODL declaration, no stated permission.

This is the opposite of what most people assume.

### The actual copyright position on Indian bare Acts

Three provisions of the **Copyright Act, 1957** control:

- **s.17(d)** — Government is first owner of copyright in a "Government work"
- **s.2(k)** — that includes works "made or published by or under the direction or control of the government, legislature, Court, tribunal..." Statutes qualify.
- **s.28** — copyright in a Government work runs **60 years** from publication. The 2025 Act is in copyright until roughly 2086.

**s.52(1)(q)** is the fair-dealing carve-out, and its drafting is precise:

> "the reproduction or publication of — (i) any matter which has been published in any Official Gazette **except an Act of a Legislature**; (ii) **any Act of a Legislature subject to the condition that such Act is reproduced or published together with any commentary thereon or any other original matter**; ... (iv) any judgment or order of a court, Tribunal or other judicial authority, unless ... prohibited..."

Read those together:

- **Circulars, notifications, orders and instructions published in the Gazette are freely reproducible.** Clean.
- **Acts are expressly carved OUT of the gazette exemption.**
- **An Act may be reproduced only "together with any commentary thereon or any other original matter."**

So **verbatim reproduction of bare Act text, standing alone, is not covered by s.52(1)(q) and is prima facie infringement of Government copyright.** This is why every Indian commercial bare-act publisher ships annotations rather than plain text.

There is a genuine counter-current — the Bombay High Court has observed that enactments are in the public domain, and no Indian court has ever enforced Crown copyright against a bare-act publisher. **The risk is legal-theoretical, not commercial-practical.** But "nobody has been sued" is not a licence, and the mitigation is cheap.

### Mitigation — which happens to be the same thing as building a good product

A RAG chatbot that retrieves a section and *explains* it is doing precisely what s.52(1)(q)(ii) contemplates. Concretely:

1. **Never surface raw section text as the whole answer.** Always pair retrieved text with generated explanation, worked examples or cross-references. That is your "commentary thereon".
2. **Ship your own editorial layer** — section summaries, plain-language headnotes, AY-applicability annotations, the 1961↔2025 cross-mapping. This is original matter and independently earns *you* copyright under the "skill and judgment" standard from *Eastern Book Company v. D.B. Modak*.
3. **Don't build a bare-text browser as a standalone feature.**

**s.52(1)(r)** additionally permits Indian-language translations of an Act where Government has not published one, provided you carry a prominent notice that "the translation has not been authorised or accepted as authentic by the Government." Relevant if you plan Hindi or regional versions — the notice is mandatory, not optional.

### GODL-India applies as a model, not as authority

GODL grants a worldwide, royalty-free, non-exclusive licence for all lawful commercial and non-commercial purposes, with mandatory formatted attribution. **But it attaches to datasets published under it on data.gov.in and siblings. incometaxindia.gov.in has not adopted it.** Use GODL as your model for *how to attribute*; do not cite it as your legal basis for reproducing the Act. An adversary would notice.

### Case law — my recommendation is to exclude it from v1

s.52(1)(q)(iv) makes raw judgments freely reproducible. What is *not* free is a commercial publisher's headnotes, editorial paragraph numbering and cross-references — the exact holding of *Eastern Book Company v. D.B. Modak*. So take judgments from government sources, never from a commercial reporter's rendering.

But for a consumer-facing tax app, case law is where hallucination risk is highest, where the product adds least value, and where the "this is advice" line is easiest to cross. Leave it out until you have a specific reason.

---

## 4. The regulatory line

### Tax advice

India has no statutory monopoly on *giving* tax opinions. What is restricted is **representation**: s.288 of the 1961 Act (2025 Act successor to be identified via the mapping utility) governs who may appear as an "authorised representative" before income-tax authorities — an enumerated list including CAs, advocates and registered income-tax practitioners.

The line: **explaining the law, generally — fine. Representing a taxpayer, signing, certifying, or filing on their behalf — restricted.** Two practical rules: never let the product describe itself as replacing a CA, and if you add filing you need ERI registration, which is its own licensing regime.

### SEBI — this is the one that will actually catch you

Regulation 2(1)(l) of the SEBI (Investment Advisers) Regulations, 2013 defines investment advice as advice relating to investing in, purchasing, selling or dealing in securities or investment products, **including financial planning**. Two exemptions matter:

1. **The media carve-out** — advice given through a medium "widely available to the public" falls outside the definition. A general-purpose chatbot answering undifferentiated questions plausibly sits here.
2. **Regulation 4** — members of ICAI/ICSI/ICMAI advising incidentally to practice are exempt. SEBI's own FAQ uses exactly the example of a CA advising a tax client to invest in ELSS during tax planning.

**Where you cross the line is personalisation.** The moment the product ingests a user's income, holdings or risk profile and recommends *specific* securities or products, you are giving investment advice requiring registration.

**80C/ELSS is the trap.** This is fine:

> "Section 80C allows a deduction up to Rs 1.5 lakh. Eligible instruments include ELSS, PPF, EPF, life insurance premia and home loan principal."

This is not:

> "Given your Rs 18 lakh salary, put Rs 1.5 lakh into ELSS fund X."

Note both exemptions are narrower than they look. Reg. 4 protects professionals only while advisory is *incidental*, not the principal business — an app whose principal business is advice cannot lean on it. And a highly personalised chatbot is not "widely available to the public" in the sense reg. 2(1)(l) means. SEBI has been actively tightening here since the 2024-25 finfluencer measures.

**Your NPS and government-schemes section is where this bites.** Describing PPF, NPS and SCSS mechanics and tax treatment is education. Ranking them for a specific user's situation edges toward advice. Draw the line deliberately rather than discovering it later.

### RBI and DPDP

RBI engages only if you touch deposits, lending, payments or aggregation. Pure tax content: not applicable. Account Aggregator integration would put you into the AA framework with consent-artefact obligations.

**DPDP Act 2023 was not researched and sits outside the brief, but flagging it:** a tax chatbot ingesting user income data is processing personal data at scale. Consent notices, purpose limitation and breach notification apply. Get this reviewed by counsel — it is a bigger practical exposure than the copyright question.

### Disclaimer

Composite, modelled on the ITD's own disclaimer plus standard Indian fintech practice. **Illustrative, not lawyer-drafted** — have counsel settle the final wording:

> *The information provided is for general informational and educational purposes only and does not constitute legal, tax, financial or investment advice. It should not be construed as a statement of law or used for any legal purpose. In case of any variance between the information here and the relevant Act, Rules, Regulations, Circulars or Notifications, the latter shall prevail. Tax treatment depends on individual circumstances and on the assessment year concerned, and may change. We are not a SEBI-registered Investment Adviser and do not provide investment advice or recommend any security or investment product. Please consult a qualified chartered accountant, tax practitioner or registered investment adviser before acting. [Company] accepts no liability for any loss or damage arising from reliance on this information.*

Surface it at onboarding and keep it persistently visible in the chat UI — not buried in settings. Add a source citation with section number and date on every substantive answer. That is both good UX and your best evidence of good faith.

---

## 5. Commercial options

| Provider | Offering | Pricing | Verdict |
|---|---|---|---|
| **Sandbox (by Quicko)** — `sandbox.co.in/income-tax`, `developer.sandbox.co.in` | Tax **calculation** APIs (salary, capital gains, F&O, foreign income, crypto), AI document extraction (Form 16, 26AS, AIS, ITR), Tax P&L, embeddable filing SDKs. "Coded as per latest income tax act, tested and verified by qualified accountants." | Not published. Free trial; cost calculator at `/tools/cost-calculator`. | **Best fit.** Solves computation, not the corpus. Licensing the calculator and building the corpus yourself is the right split. |
| **ClearTax** — `docs.cleartax.in` | Income tax + GST APIs | Enterprise sales | More GST-weighted |
| **Taxmann** | Deepest Indian direct-tax research corpus — annotated Acts, rules, circulars, case law, commentary | Income Tax module Rs 20,900/yr; Premium Rs 37,000; Direct Tax Specialist Rs 39,500; IT+GST Premium Rs 51,000 — all ex-18% GST | **Do not licence for v1.** The subscription brochure says nothing about API access, data licensing or redistribution. These are **seat licences for human research, not content licences.** Ingesting Taxmann into a RAG index almost certainly breaches ToS and infringes their editorial copyright. The price is manageable; the rights are the problem. **Do not scrape.** |
| **Indian Kanoon API** — `api.indiankanoon.org` | 3+ crore orders, enriched HTML, ML classification | Per call: search Rs 0.50, original doc Rs 0.50, doc Rs 0.20, fragment Rs 0.05, metainfo Rs 0.02. Prepaid, Rs 500 signup credit. Rs 10,000/month free for verified non-commercial use. | Extremely cheap. Hold in reserve for a case-law phase. ⚠️ Read `/terms/` on commercial redistribution first. |

---

## 6. Ingestion plan

### Corpus scope, ranked by value per unit of effort

**Tier 1 — build first. About 90% of consumer queries.**

1. **Income-tax Act 2025, all 536 sections** — HTML via `/w/section-*`. The operative law.
2. **Income-tax Act 1961, all sections** — still governs AY 2026-27 and every earlier year and every pending proceeding. **Not optional.**
3. **The official 1961↔2025 mapping** — the spine that answers "what happened to 80C?" Highest leverage in the corpus.
4. **Income-tax Rules 2026 + Rules 1962**
5. **Rate schedules by year** — as **structured data, not prose chunks**. See `tax_rates.json`.
6. **The official transition FAQs** — short, authoritative, and directly on the dominant 2026 question.

**Tier 2 — second sprint.** CBDT circulars (current + ~10 years), notifications (current + ~10 years), the Memorandum Explaining the Provisions, forms and the form mapping guide.

**Tier 3 — only with a clear use case.** Instructions and CBDT orders, press releases, case law.

**Out of scope for v1:** international taxation and DTAA, transfer pricing, Black Money Act, Benami Act. Each is a corpus of its own and consumers don't ask.

### Volume — estimates, not measured

| Item | Units | Est. tokens |
|---|---|---|
| Act 2025 (536 sections) | 536 | 1.5-2.5M |
| Act 1961 (~800 sections) | ~800 | 3-4M |
| Rules 2026 + 1962 | 700-900 | 1.5-2M |
| Circulars, 10 years | 600-900 | 2-3M |
| Notifications, 10 years | 1,000-1,500 | 1.5-2.5M |
| Transition FAQs, memoranda | ~30 | 0.5M |
| **Tier 1+2** | **~3,700-4,700 docs** | **~10-15M tokens** |

Small. A few GB with embeddings. **Volume is not your problem. Correctness under temporal ambiguity is.**

### Chunking

**Chunk at the section level, not by fixed token windows.** Legal text is already authored in semantically complete units and fixed-window chunking destroys exactly the structure you need.

- **Default unit = one section**, including provisos, Explanations and illustrations. An Explanation severed from its section is worse than useless — it inverts meaning.
- **Split long sections at subsection boundaries** (s.2 of the 2025 Act has 112 definitions). Never mid-proviso. Carry the section heading and an `Act > Chapter > Section` breadcrumb into each child chunk.
- **Definitions get individual chunks** keyed to the defined term, and stay in the parent too.
- **Schedules: one chunk per entry**, not per schedule.
- **Circulars and notifications: whole-document chunks** unless over 2k tokens.
- **Prepend a synthetic header to every chunk** (act, year, section number, heading, applicability). Cheap, and it dramatically improves retrieval precision on numeric queries.
- **Keep the amendment footnotes.** They are how you answer "when did this change?"

**Retrieval must be hybrid dense + BM25.** Users type exact section numbers and defined terms, which pure embeddings retrieve badly. Add an exact-match lookup on `section_number` that bypasses the vector store entirely.

### Metadata schema

```json
{
  "chunk_id": "ita2025-s123-ss1-001",
  "act": "Income-tax Act, 2025",
  "act_short": "ITA2025",
  "act_number": "30 of 2025",
  "doc_type": "act_section",
  "chapter": "VIII",
  "section_number": "123",
  "section_heading": "Deductions in respect of certain payments",
  "subsection": "1",
  "clause": null,
  "proviso": null,
  "explanation": null,

  "corresponding_provision": {
    "act": "Income-tax Act, 1961",
    "sections": ["80C", "80CCC"],
    "relationship": "many_to_one",
    "source": "CBDT official mapping utility",
    "confidence": "official"
  },

  "applicability": {
    "from_tax_year": "2026-27",
    "to_tax_year": null,
    "from_assessment_year": null,
    "to_assessment_year": null,
    "in_force_from": "2026-04-01",
    "in_force_to": null
  },

  "status": "in_force",
  "supersedes": [],
  "superseded_by": [],
  "amended_by": [{"instrument": "Finance Act, 2026", "effective": "2026-04-01"}],

  "source": {
    "url": "https://www.incometaxindia.gov.in/w/section-123-XX",
    "publisher": "Central Board of Direct Taxes",
    "gazette_ref": null,
    "retrieved_at": "2026-09-13T00:00:00Z",
    "content_hash": "sha256:...",
    "authority_tier": 1
  },

  "language": "en",
  "topics": ["deductions", "chapter_via", "tax_saving"],
  "editorial": {
    "plain_summary": "...",
    "worked_example": null,
    "author": "internal",
    "reviewed_by": null,
    "reviewed_at": null
  }
}
```

Three design choices worth defending:

- **`authority_tier`** (1 = Act/Rules/Gazette, 2 = circular/notification, 3 = FAQ/press release, 4 = editorial) lets the model rank conflicting retrievals. When tiers disagree, the lower tier loses *and the answer says so*.
- **`content_hash`** gives free change detection on re-crawl. Critical, because CBDT amends pages in place without changing URLs.
- **`editorial`** is simultaneously your s.52(1)(q)(ii) commentary and your own copyrightable layer. Not an afterthought.

**Model both `tax_year` and `assessment_year`.** The 2025 Act replaced the previous-year/assessment-year pair with a single "tax year". Users will say "AY" for years. You need both vocabularies and a translation.

---

## 7. The hard problems, stated honestly

### (a) Two Acts are in force simultaneously — the defining problem

Per the official Interplay & Transition FAQ: the **1961 Act governs every tax year beginning before 1 April 2026** (through AY 2026-27); the **2025 Act governs tax years beginning on or after 1 April 2026**. The repealed Act continues to apply to proceedings pending at commencement *and* to proceedings initiated after 1 April 2026 in respect of pre-2026 years. The e-filing portal runs both in parallel.

So in 2026 a user asking "what's the 80C limit?" may mean either Act depending on which year they are filing for — **and most will not know which they mean, or that the question is ambiguous.**

Mitigations, none optional:

- Make the year a **first-class retrieval filter**, not a re-ranking hint.
- **Ask when ambiguous.** A clarifying question beats a confidently wrong year.
- **Answer both** where they differ and the user hasn't specified, labelled by year.
- Use the mapping table as a **query-expansion layer** — a question about "80C" retrieves both the 1961 provision and its 2025 successor.
- Expect this to persist **6+ years**, until the last pre-2026 assessment and appeal cycle closes.

### (b) Circular supersession is genuinely unsolved

CBDT does not maintain a machine-readable supersession graph. A 2019 circular may be expressly superseded, partly overridden by a later circular, impliedly overridden by a statutory amendment, or struck down by a court — **and the original document is never edited or flagged. It sits on the site looking authoritative forever.**

This is **the highest hallucination risk in the system**, because a superseded circular is fluent, official-looking, specific and wrong — the worst possible combination.

Partial mitigations, with honest limits:

- Parse "in supersession of", "in partial modification of" and "stands withdrawn" from circular text to build the graph automatically. Catches express supersession only — perhaps 60%, and that is an estimate, not a measurement.
- Apply a **recency prior within topic clusters**. Heuristic, not sound.
- Flag any circular predating a relevant statutory amendment as `possibly_affected` and surface that caveat in the answer.
- **Always show the circular's date and number.** Let the user apply judgment you cannot.
- **Accept that this needs human review.** Budget a tax professional to curate supersession for the top ~200 circulars by query volume. There is no purely automated answer, and anyone who says otherwise is selling something.

### (c) Other problems worth planning for

- **Amendment history within a section.** Section text differs by year; the `/w/section-*` footnotes encode this as prose, not structured data. Full point-in-time reconstruction across 60+ years of the 1961 Act is a multi-month project on its own. **Descope it**: ingest the current consolidated text, retain footnotes in-chunk, and be explicit that historical-year answers are lower-confidence.
- **PDF extraction quality.** Gazette PDFs are often scans; statutory PDFs use multi-column layouts with marginal notes that naive extractors mangle — and mangled statutory text is *silently* wrong. **Prefer the HTML `/w/section-*` route wherever it exists.**
- **Silent in-place updates.** CBDT amends pages without changing URLs or announcing it. Re-crawl Tier 1 **weekly** with hash comparison; check Tier 2 **daily** for new items, using PIB RSS as the cheap trigger.
- **The mapping is many-to-many.** One 1961 section may split across several 2025 sections and vice versa. Model it as a graph with relationship types (`one_to_one`, `one_to_many`, `many_to_one`, `split`, `merged`, `omitted`, `new`), not a two-column lookup.
- **Never let the LLM do arithmetic on retrieved prose.** Slabs, thresholds, limits and rebates live in a structured, versioned table queried deterministically. A wrong slab rate is the most damaging error this product can make.

---

## 8. Open items for this workstream

1. **Open a mapping utility with DevTools and capture the XHR.** Highest-value unknown here. Ten minutes.
2. **Test India Code's OAI-PMH** at `indiacode.gov.in/oai/request?verb=Identify`. The only plausible true bulk-harvest route.
3. **Page through all 44 pages of the Liferay headless API** and test `/structured-contents`. Establish what is actually in those 869 documents.
4. **Confirm the schedule count for the 2025 Act** against the consolidated PDF's arrangement of sections before hard-coding 16.
5. **Read Indian Kanoon's `/terms/`** on commercial redistribution before planning a case-law phase.
6. **Check robots.txt** for incometax.gov.in, egazette.gov.in, indiabudget.gov.in and pib.gov.in before crawling any of them. Only incometaxindia.gov.in was verified.
7. **Get Indian IP counsel to confirm the bare-text position.** The analysis above reasons from statutory text and secondary commentary; no Indian court has squarely decided it.
8. **Get DPDP Act 2023 compliance reviewed.** Bigger practical exposure than the copyright question.

Engineering hygiene regardless of permission: respect `Crawl-delay`, rate-limit to single-digit requests per second, set a real User-Agent with contact details, cache aggressively, and never hammer e-Gazette. Being allowed to crawl and being a good citizen are different things, and the second is what keeps you allowed.
