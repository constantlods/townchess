# Voice options for The Annotator

Status: research only. Nothing was signed up for, bought or installed. All prices and licence terms were seen on
**2026-10-03** at the URLs in the Sources section (numbered `[n]`). Prices change often, so re-check before you pay.
This is not legal advice. Read the actual licence or terms before you ship.

## 0. Summary

| Rank | Option | Cost for this project | Commercial use in a sold game | Steam AI disclosure | Why |
| --- | --- | --- | --- | --- | --- |
| **1** | **Owner-recorded voice** + Audacity or REAPER + free plugins + our own steel-plate IR | $0 with a mic you already own, about $70–130 for a Samson Q2U [33] | Yes. You own the recording [31] | Not needed (no generative AI) [2] | No licence risk. It already fits the voice direction, which asks for close-mic, quiet, no-gimmick delivery and our own convolution IR |
| **2** | **Local open model on the RTX 4070 Ti SUPER**: Qwen3-TTS (Apache-2.0) first, Chatterbox (MIT) second | $0 plus electricity | Yes. The weights are permissive [20][21][16][17] | Yes, "pre-generated" [2] | Unlimited iteration, works offline, no account. Voice design from a text description (Qwen3) and cloning of the owner's own voice (both) |
| **3** | **ElevenLabs Creator** (paid) | About $22–44 (1–2 months), or $99 for one Pro month [5] | Yes on any paid plan. The free plan is non-commercial [6][7] | Yes, "pre-generated" [2] | Best-in-class expressive control (`[whispers]`, `[hushed]`, `[pause]` tags in v3/v4 [9][10]). Licence to the output is perpetual after you cancel [6][8] |

**Blockers and warnings**

- **Do not use these for shipped audio, because their licences are non-commercial:** Coqui XTTS-v2 (CPML, and there is
  no way to buy a commercial licence since Coqui closed) [13][14], F5-TTS pretrained weights (CC-BY-NC-4.0) [18],
  Fish Audio / OpenAudio S1-mini open weights (CC-BY-NC-SA-4.0) [24], and anything made on a **free** tier of
  ElevenLabs, Cartesia, WellSaid or Hume.
- **PlayHT no longer exists.** Meta acqui-hired the team in July 2025. The service shut down on 31 Dec 2025 and
  voices and audio were deleted without export [12]. This is the clearest example of provider risk.
- **Microsoft custom neural voice and personal voice are Limited Access.** They are only for "customers managed by
  Microsoft" with an approved use case, so a solo developer realistically cannot get them [11].
- Any AI voice you ship (including a clone of your own voice) must be declared in Steam's Content Survey as
  pre-generated AI content [2].

## 1. Assumptions behind the cost estimates

- The current `content/characters/annotator.json` has **69 lines, averaging 7.3 words / 37.6 characters**.
- Brief: **300 shipped lines × 8 words ≈ 300 × 38 ≈ 11,400 characters**, plus about **5,000 experimental generations ≈
  190,000 characters**. **Total ≈ 200,000 characters.**
- Duration: with slow delivery and held-breath ellipses, assume about 3.5 s per line, so 5,300 lines ≈ 18,500 s ≈
  **310 minutes** of generated audio. The shipped set is about 17–18 minutes.
- Prices are list prices in USD, excluding tax.

## 2. Steam's AI disclosure rules (current)

Source: Steamworks "Content Survey" documentation [2], plus the January 2026 clarification reported by PC Gamer [3].

- There are two categories:
  - **Pre-generated**: content that "ships with your game and is consumed by players that is created with the help
    of AI tools during development".
  - **Live-generated**: content "created with the help of AI tools while the game is running".
- You describe the implementation in the Content Survey, and Steam shows the disclosure on the store page.
- **Live-generated content** also requires you to describe "what kind of guardrails you're putting on your AI to ensure
  it's not generating illegal content". Players get an overlay button to report it [2][4].
- **Efficiency tools are excluded.** "Efficiency gains through the use of these tools is not the focus of this
  section" [2]. In January 2026 Valve reworded the form so that it focuses on AI content that is **consumed by
  players** [3].
- **What this means for TownChess:**
  - Owner-recorded lines, with ordinary EQ, compression, convolution or even an AI noise-reduction step, are not
    generated content. No disclosure is needed. If in doubt, a short honest note costs nothing.
  - Any TTS or cloned line that ships is **pre-generated** and must be disclosed.
  - Runtime TTS would be **live-generated** and needs guardrails. That is another reason not to do runtime TTS. The
    script is fixed, so pre-render everything.
- **Related regulation:**
  - EU AI Act Article 50 transparency obligations apply from **2 Aug 2026**. Deepfakes that are "evidently artistic,
    creative, satirical or fictional" get an attenuated disclosure duty, not a full exemption [36][37]. A fictional
    masked clerk who resembles no real person is unlikely to be a "deepfake", but a voice that sounds like a real person
    could be.
  - Some providers also require you to disclose AI voices to end users:
    - OpenAI requires "a clear disclosure to end users that the TTS voice they are hearing is AI-generated" [26].
    - ElevenLabs' Prohibited Use Policy requires clear disclosure where users interact with AI [7].
    - Microsoft requires disclosure of custom voice models [11].
  - A Steam store disclosure plus a credits line ("Voice of The Annotator generated with X") covers these
    requirements in practice.

## 3. Commercial cloud TTS / voice design

The per-project cost uses the about 200k characters / 310 minutes from §1.

### 3.1 ElevenLabs (recommended cloud option)

- **Price** [5]:
  - Free: 10k credits, $0.
  - Starter: 30k credits, $6/mo.
  - Creator: 121k credits, $22/mo.
  - Pro: 600k credits, $99/mo.
  - Scale: 1.8M credits, $299/mo.
  - Business: 6M credits, $990/mo.
  - Multilingual v2 costs 1 credit per character, and Flash/Turbo costs 0.5–1 credit [5]. The per-character rate for
    v3/v4 was not visible on the page.
- **Estimate:** about 200k credits means **2 months of Creator ($44) or 1 month of Pro ($99)**.
- **Commercial use:**
  - The free plan "does not include a commercial license and cannot be used for any commercial purpose" [6].
  - "All paid plans include a commercial license, provided you're not using Beta Services" [6]. Beta-feature output
    cannot be used commercially [6]. Check that the model and feature you use are GA:
    - Eleven v3 is GA [9].
    - Eleven v4 is presented as a general release, top-ranked as of Sept 2026 [10].
- **Shipping in a binary:** no clause forbids embedding owned output in a product. Terms: "You retain all rights to your
  Output", with a "perpetual and irrevocable" licence [8].
- **After cancelling:** content generated during a subscription stays commercially licensed "forever" [6].
- **Attribution:** none on paid plans. Free-plan output must carry "elevenlabs.io" or "11.ai" in the title [6].
- **Cloning and consent:**
  - Instant cloning is available from Starter and professional cloning from Creator [5].
  - You must have "all the rights necessary" to the input [8].
  - The use policy forbids replicating "the voice of another person ... without consent or legal right" [7].
  - Cloning your own voice is allowed.
- **Voice design** creates a new synthetic voice from a description. Voice remixing can alter voices you own or
  designed [10a].
  - **Avoid Voice Library voices for the hero character.** Their owners can withdraw them, with a notice period of
    30 days to 2 years. Audio you already generated stays usable, but you lose the voice for new lines [25].
- **Horror suitability:** excellent.
  - v3/v4 audio tags include `[whispers]`, `[hushed]`, `[sighs]`, `[pause]` and `[long pause]` [9][10].
  - Consistency is good with one fixed designed voice plus fixed settings.
- **Latency/offline:** cloud only, so pre-generate.
- **Risk:**
  - Terms are updated often (31 Mar 2026 [8], use policy 17 Aug 2026 [7]).
  - A voice that exists only on their servers is lost if your account or the service goes. Keep the dry WAVs.

### 3.2 Microsoft Azure AI Speech

- **Price** (Azure Retail Prices API, East US) [1b]:
  - Neural TTS: $15 per 1M characters.
  - Neural HD: $22 per 1M (effective 2026-03-01).
  - Custom neural synthesis: $24 per 1M.
  - Custom neural training: $52 per compute hour, plus $4.032 per hour for endpoint hosting.
  - Personal voice: $24 per 1M.
  - Free tier F0: 0.5M neural characters per month [1].
- **Estimate:** $0 within F0. Otherwise about $3 (neural) or about $4.40 (HD).
- **Commercial use:** allowed under Azure terms for prebuilt voices.
  - Custom neural voice and personal voice are **Limited Access**: "Only customers managed by Microsoft ... are
    eligible". You need explicit written permission from the talent, a recorded consent statement verified by speaker
    recognition, and disclosure of the synthetic nature to users [11].
  - So cloning is effectively unavailable to a solo developer.
- **Attribution:** none found for prebuilt voices.
- **Horror suitability:**
  - Prebuilt voices with SSML styles exist (some voices offer "whispering").
  - Microsoft stock voices are well known, so the character is less unique.
- **Risk:** low shutdown risk. Stock voices are shared with every other customer.

### 3.3 Google Cloud Text-to-Speech

- **Price** [27]:
  - Chirp 3 HD: 1M characters free per month, then $30/1M.
  - Instant custom voice: no free tier, $60/1M.
  - Neural2: 1M free, then $16/1M.
  - Studio: 1M free, then $160/1M.
  - WaveNet/Standard: 4M free, then $4/1M.
  - Gemini 3.8 Flash TTS (Preview): $0.50/1M text tokens + $9/1M audio tokens until 31 Dec 2026, doubling to
    $1/$18 from 1 Jan 2027. Audio is billed at 25 tokens per second [27].
- **Estimate:**
  - Chirp 3 HD: $0 inside the free tier.
  - Gemini Flash TTS: about 18,500 s × 25 = 463k audio tokens, so about **$4**.
  - Instant custom voice: about $12.
- **Caution:** "Preview" models may carry pre-GA terms, so check before shipping.
- **Cloning/consent:** the Instant custom voice access and consent process was not verified (the docs page redirected
  during research). Assume a consent recording is required.
- **Horror suitability:** Gemini TTS accepts natural-language style prompts ("say quietly, flatly"), which is useful
  for whisper and low delivery.
- **Risk:** Google renames and deprecates models often (the "Legacy TTS models" section [27]).

### 3.4 Amazon Polly

- **Price** [28]:
  - Standard: $4/1M.
  - Neural: $16/1M.
  - Long-form: $100/1M.
  - Generative: $30/1M.
  - Free tier: 5M standard per month; 1M neural, 500k long-form and 100k generative per month for the first 12 months.
- **Estimate:** $0 (neural free tier) or about $3 (generative after the free 100k).
- **Rights:** "As between you and AWS, your Polly output belongs to you". You "can cache and replay Amazon Polly's
  generated speech at no additional cost" [29].
- **Cloning:** Brand Voice only through an AWS account-manager engagement [29].
- **Horror suitability:** the weakest of the group for expressive acting. Usable for placeholders only.

### 3.5 OpenAI TTS

- **Price** [26a]:
  - tts-1: $15/1M characters.
  - tts-1-hd: $30/1M.
  - gpt-4o-mini-tts: $0.60/1M text tokens in, $12/1M audio tokens out.
- **Estimate:** about $3 (tts-1) or about $6 (tts-1-hd). For gpt-4o-mini-tts, the tokens-per-second rate was not
  shown, but expect single-digit dollars.
- **Voices:** 13 preset voices, with marin and cedar recommended. gpt-4o-mini-tts takes instructions for tone, speed
  and **whispering** [26].
- **Custom voices** need an approved consent recording and have eligibility rules [26].
- **Disclosure:** the usage policies require telling end users the voice is AI-generated [26]. A store disclosure plus
  a credits line should satisfy this for pre-rendered game audio.
- **Risk:** the preset voices are heard in many products, so they are not distinctive.

### 3.6 Resemble AI

- **Price:** the Flex plan is pay-as-you-go, $0 to start, and credits never expire [30].
  - Secondary sources give TTS at **$0.0005/s**, Rapid Voice Clone at $2/mo per voice and Professional at $5/mo per
    voice [30a]. The official page did not show TTS rates when fetched, so verify.
- **Estimate:** about 18,500 s × $0.0005 ≈ **$9**, plus about $2–5 per month for a clone.
- **Notes:** Resemble also publishes Chatterbox (MIT, see §4), so the same voice style is reachable locally.

### 3.7 WellSaid

- **Price** [32]:
  - Trial: free, 3 min of downloads per month, **not commercial**.
  - Starter: $19/mo (or $10/mo billed annually), 20 min of downloads per month.
  - Pro: $49/mo, 180 min of downloads per month.
  - Generation and retakes are unlimited. Only downloads count.
- **Estimate:** **$19–49** (the final 300 lines is about 18 min).
- **Licence:** paid plans give commercial rights [32a].
  - The online services agreement describes a "non-exclusive, limited, revocable, nontransferable, non-sublicensable"
    licence [32a].
  - Shipping the audio inside a game binary that end users receive is **not explicitly addressed**. Get written
    confirmation before using it.
- **Cloning:** none on the self-serve plans [32].
- **Fit:** corporate narration voices. Poor horror fit.

### 3.8 PlayHT

- **Shut down.** The API went offline around 26 Jul 2025, and everything closed on **31 Dec 2025** with accounts,
  clones and audio deleted [12].

### 3.9 Cartesia (Sonic)

- **Price** [34]:
  - Free: 20k credits, **non-commercial**.
  - Pro: $5/mo, 100k credits, commercial use, instant cloning.
  - Startup: $49/mo, 1.25M credits, professional cloning.
  - Scale: $299/mo, 8M credits.
  - 1 credit = 1 character.
- **Estimate:** 2 months of Pro = **$10**.
- **Terms** [35]:
  - No ownership claim on outputs.
  - Outputs "may not be unique".
  - No voice of "any other person ... without that person's express permission".
  - Cartesia **may train on inputs and outputs** unless you opt out (terms dated 14 Jun 2024).
- **Fit:** built for low-latency agents. Fine for prototyping.

### 3.10 Notable 2025–2026 entrants

| Provider | Price seen | Commercial | Notes |
| --- | --- | --- | --- |
| Hume Octave [38] | Free 10k chars; Starter $3; Creator $7 (140k chars); Pro $70 (1M); overage $0.12/1k on Creator | All paid tiers | Strong at emotional direction from prompts. Estimate about $14 (Creator + 60k overage) |
| Inworld TTS [39] | Free "On-Demand" (up to 70 min TTS); Creator $25/mo in credits; enterprise "as low as $5/1M chars" | All paid plans | Game-industry focus. Per-character list rates were not visible |
| Fish Audio (hosted) [40] | Free 8k credits; Plus $11/mo (about 200 min); Pro $75/mo | The page is contradictory: the table says commercial use on Free, while the text limits commercial use to paid plans with "verified voices (that you own)" | **Do not confuse with the open S1-mini weights, which are CC-BY-NC-SA** [24] |
| Google Gemini TTS / ElevenLabs v4 | See §3.3 / §3.1 | | The main 2026 quality jumps |

## 4. Local / open-source TTS on the RTX 4070 Ti SUPER (16 GB)

All of these cost $0 per line. They run offline and need no account. The output is **pre-generated AI content** for
Steam. In the US, purely AI-generated material is not protected by copyright (prompts alone are insufficient). Human
selection, arrangement and modification can be protected [41]. In practice, nobody can stop you shipping the files,
but you cannot stop others copying the raw TTS output either. The same applies to cloud TTS.

| Model | Licence (weights) | Commercial? | Cloning | Horror-relevant control | Notes |
| --- | --- | --- | --- | --- | --- |
| **Qwen3-TTS** (Alibaba, released 22 Jan 2026) [20][21] | **Apache-2.0** | **Yes** | 3 s reference + transcript (Base) | **VoiceDesign** builds a voice from a natural-language description. Instruction control of emotion, rate and prosody | 0.6B and 1.7B models. Fits easily in 16 GB. Python 3.12. Windows not explicitly documented (WSL2 works as a fallback). Best first local try |
| **Chatterbox** (Resemble AI) [16][17] | **MIT** | **Yes** | Zero-shot, about 5 s reference | "Exaggeration" control. Turbo/Nano take `[cough]`, `[laugh]` tags | Variants: Turbo 350M, Nano 110M, Multilingual V3 500M. **Perth watermark** in every output (harmless, even helpful as provenance) |
| Kokoro-82M [15] | **Apache-2.0** | Yes | **No** (54 preset voices) | Little | Tiny and fast. Training data documented as permissive/public domain [15]. Good for placeholder VO and pipeline testing. It cannot produce a unique character voice |
| Zonos v0.1 (Zyphra) [22] | **Apache-2.0** | Yes | Yes | Emotion, pitch, rate and "max frequency" controls | Linux-first, needs eSpeak, 6 GB+ VRAM |
| Dia / Dia2 (Nari Labs) [23] | **Apache-2.0** | Yes (consent and anti-deception conditions in the README) | Yes, 5–10 s | `(sighs)`, `(gasps)`, `(mumbles)` | English only. About 4.4 GB VRAM in bf16. The voice drifts unless you fix the prompt audio or seed |
| Orpheus 3B (Canopy) [42] | Card says **Apache-2.0**, but built on Llama 3.2 3B, so check whether the Llama licence also applies | Probably | Zero-shot | Emotion tags | Bans impersonation without consent |
| NeuTTS Air (Neuphonic) [43] | **Apache-2.0** | Yes | 3 s | Moderate | 0.7B and CPU-capable. Perth watermark |
| Kyutai TTS 1.6B [44] | **CC-BY-4.0** | Yes, **with attribution** | Only pre-computed voice embeddings (deliberately limited) | Moderate | EN/FR. Needs a credits line |
| StyleTTS2 [19] | Code MIT. **Pretrained-model condition:** tell listeners the speech is synthesized unless you have permission to use the voice | Yes, with that condition | Yes | Good prosody | Aging codebase |
| Piper (OHF-Voice/piper1-gpl) [45] | **GPL-3.0** code. Each voice has its own licence | Shipping the engine in the game is a GPL issue. Pre-rendered WAVs are not, but check each voice's licence | Train your own voice | Robotic/clean | The original rhasspy/piper is archived and the fork is looking for maintainers |
| Bark (Suno) [46] | **MIT** | Yes | No (presets) | Wild, non-verbal sounds | Last updated May 2023, so effectively unmaintained. Unpredictable |
| Higgs Audio v2 (Boson) [47][48] | Code Apache-2.0. **Weights use the "Boson Higgs Audio 2 Community License"** (Llama-3-based) | Yes under 100k annual active users. Requires a "Built with Higgs Materials..." attribution notice | Yes | Very expressive | Watch the attribution and naming clauses |
| IndexTTS-2 (bilibili) [49] | Custom "bilibili Model Use License" | Yes, unless you exceed 100M MAU or RMB 1B revenue. Keep the notices | Yes | Emotion and **duration control** | Custom licence, so read it in full |
| VibeVoice (Microsoft) [50] | MIT | Microsoft: "We do not recommend using VibeVoice in commercial or real-world applications". It **inserts an audible AI disclaimer into every file** | | | **Unusable** for game VO |
| **Coqui XTTS-v2** [13][14] | **CPML: NON-COMMERCIAL** | **NO.** No commercial licence can be bought (Coqui closed in Jan 2024; confirmed 16 Feb 2026) | | | **Do not ship** |
| **F5-TTS** pretrained [18] | **CC-BY-NC-4.0** (Emilia data) | **NO** | | | **Do not ship.** Fine for private experiments only |
| **Fish/OpenAudio S1-mini** [24] | **CC-BY-NC-SA-4.0** | **NO** | | | **Do not ship** |

Notes for local models:

- **Cloning and consent:**
  - Cloning **your own voice** is the clean case. You are the speaker and the rights holder, so no third-party consent
    is needed. Keep a dated note ("reference audio recorded by <owner>, consenting to synthesis for TownChess").
  - Cloning **anyone else** needs their written, informed consent covering synthesis, commercial sale and the term.
  - **Never** clone or imitate a known performer. The character brief already forbids sound-alikes of horror
    performers.
- **Training-data provenance:** only Kokoro documents permissive training data [15]. Other models trained on
  web-scraped speech carry some unresolved upstream risk, the same as most cloud models.
- **Consistency across sessions:**
  - Generate one "golden" reference clip (designed or recorded) and always clone from that exact file.
  - Pin the model version (commit hash) and the seed.
  - Store all parameters (see §6).
  - Do not rely on "design a new voice from the description each time". You will get a different person.

## 5. Owner-recorded voice (zero-licence-risk baseline)

- **Microphone:**
  - Any decent dynamic mic suits a quiet, close-mic delivery and rejects room noise. A Samson Q2U (USB + XLR) is
    about $70, or about $100–130 as a pack [33].
  - Record in a closet or under a duvet at 48 kHz/24-bit, 5–10 cm from the mic, with a pop filter.
- **Software:**
  - **Audacity**: free, GPL. "If you are the sole creator ... the intellectual property rights ... is retained by
    you" [31].
  - **REAPER**: 60-day free evaluation, then $60 discounted licence (individuals, or revenue ≤ $20k/year) or $225
    commercial [51].
  - **ReaPlugs** (ReaEQ, ReaComp, ReaGate, ReaFIR noise subtraction): free VSTs for any host [52]. Convolution
    (ReaVerb) is in REAPER itself, not in ReaPlugs [52].
- **The chain from annotator.json:** HPF 90 Hz → steel-plate IR at 25–35 % wet → −2 dB @ 2.5 kHz, +1.5 dB narrow
  @ 5 kHz → short room send. No pitch shift, ring mod, distortion or bitcrush.
  - The voice direction already says to **make our own IR** by recording a sweep 2 cm behind 1.5 mm steel. Record the
    IR yourself or use a CC0 or self-made one. Do not download random commercial IRs.
- **Can the owner sound like the character?** The casting asks for a light baritone playing 50–70, quiet and clerical
  with **no** gravel. That is a restraint brief, not a vocal-range brief, so most adult voices can perform it with slow
  pacing and flat questions. Pitch shifting is forbidden, so if the owner's voice is far off, prefer option 2 (clone
  or design) over effects.
- **Hybrid:**
  - Record 5–30 minutes of the owner reading in character.
  - Use that as the reference for Chatterbox or Qwen3-TTS to iterate new lines quickly.
  - Re-record the final keepers for real.
  - The AI-generated takes that ship must still be disclosed on Steam.
- **Cost:** $0–130. No disclosure. Full ownership. No provider risk.

## 6. Recommended provider-agnostic pipeline

```
annotator.json (owner-written text, line id, audio key)
   │  export script: one row per line id
   ▼
script.csv / takes manifest
   │  generation adapter (record | elevenlabs | qwen3 | chatterbox | ...)
   ▼
raw/<audio key>/<take>.wav  + <take>.json sidecar   (dry, 48 kHz/24-bit, never processed)
   │  select take (manual, logged in manifest)
   ▼
process (deterministic script: HPF → plate IR → EQ → trim/edit breaths → loudness normalize)
   ▼
dist/vo/annotator/<audio key>.ogg (or .wav for UE import)  + manifest entry
   ▼
game: core picks line id → client resolves audio key → plays asset (subtitle-only fallback)
```

1. **Source of truth = annotator.json.**
   - The `audio` key (for example `vo.annotator.game_start.001`) is the **stable id**.
   - Never rename a key. To revise a line, add a new take, or a new id if the text changes meaning.
   - Placeholder lines get one key per value, as already described in `content/characters/schema.md`.
2. **Generation adapters.** Write one small script per provider. Each takes the text and a `voiceProfile`, and writes
   a dry WAV plus a sidecar. The game never calls a provider.
3. **Sidecar metadata.** Store this next to every raw take, and copy it into the shipped manifest:

   ```json
   {
     "audioKey": "vo.annotator.game_start.001",
     "lineId": "annotator.game_start.001",
     "take": 3,
     "sourceText": "You may begin.",
     "sourceTextSha256": "…",
     "method": "tts",                       // "recorded" | "tts" | "clone" | "speech-to-speech"
     "provider": "qwen3-tts",               // or "elevenlabs", "owner-recording"
     "model": "Qwen3-TTS-12Hz-1.7B-Base",
     "modelVersion": "git:<commit> / api model id",
     "voiceId": "annotator_golden_v1",      // provider voice id or local reference file name
     "referenceAudio": "refs/annotator_golden_v1.wav (sha256 …)",
     "params": { "seed": 1234, "temperature": 0.6, "instruct": "quiet, flat, close", "tags": "[hushed]" },
     "generatedAt": "2026-10-03T12:00:00Z",
     "licence": {
       "terms": "Apache-2.0",               // or "ElevenLabs paid plan ToS 2026-03-31, Creator plan"
       "termsUrl": "…",
       "planAtGeneration": "n/a",
       "commercialOk": true,
       "attributionRequired": false,
       "aiGenerated": true,                 // drives the Steam disclosure and credits list
       "voiceConsent": "owner's own voice, consent note 2026-10-03"
     },
     "processing": { "preset": "plate_resonance", "chainVersion": 1, "loudnessLUFS": -23, "truePeakDb": -1 }
   }
   ```

4. **Processing is code, not hand edits.** Use a scripted chain (for example ffmpeg/sox plus a convolution step) with
   a version number.
   - Keep the dry takes, so you can change the IR or EQ, or swap providers, and re-render everything.
   - Pick one house loudness target for all VO and apply it consistently. For example −23 LUFS integrated with
     ≤ −1 dBTP true peak, then mix the level in-engine.
   - Breaths can come from the separate `sfx.annotator.breath_*` assets rather than being baked into lines.
5. **Shipped manifest.** `vo_manifest.json` maps audio key → file, duration, take, provider, `aiGenerated` and licence
   id. Build-time checks:
   - every line's `audio` key resolves;
   - no shipped asset has `commercialOk: false` (this blocks XTTS, F5 and free-tier output);
   - credits and the Steam disclosure text are generated from the `aiGenerated` and `attributionRequired` flags.
6. **Event-driven playback** stays as `CHARACTERS.md` describes it:
   - the core selects the line deterministically;
   - the client looks up the key and plays the asset;
   - a missing file falls back to subtitles.
   - No runtime TTS, so there is no "live-generated" disclosure or network dependency, and the game works offline.
7. **Provider independence.** Because text, voice id, parameters and the reference audio are stored, you can switch
   provider (or move to a hired actor later) by regenerating from `script.csv` with another adapter. A provider
   shutting down (as PlayHT did) costs nothing already rendered.
   - Keep the **golden reference clip** and all raw takes in your own backups, never only in a provider's library.

## 7. What to try first

1. **This week: record yourself (option 1).**
   - Record 10 lines with the existing mic, or a Q2U.
   - Build the plate IR from a sweep behind a steel sheet.
   - Script the chain.
   - This also gives you the processing pipeline that every other option reuses.
2. **In parallel: local Qwen3-TTS, then Chatterbox (option 2).**
   - Use VoiceDesign to describe "quiet male clerk, 60s, light baritone, precise consonants, flat".
   - Save the best result as `annotator_golden_v1.wav`.
   - Generate lines by cloning from that file with a fixed seed.
   - A/B test against a clone of your own recorded voice.
   - $0 and commercially safe. Disclose on Steam.
3. **Only if 1 and 2 are not good enough: ElevenLabs Creator for one month (option 3, $22).**
   - Design a voice (not a Voice Library voice).
   - Use v3/v4 with `[hushed]`/`[pause]`.
   - Export dry WAVs and record the plan and terms date in each sidecar.

## Sources

All accessed **2026-10-03**.

- [1] Azure Speech pricing page (F0 0.5M chars/month; dollar figures not rendered): https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/
- [1b] Azure Retail Prices API, `productName eq 'Azure Speech'`, East US (Neural $15/1M; HD $22/1M from 2026-03-01; CNV $24/1M; training $52/h; hosting $4.032/h; Personal voice $24/1M): https://prices.azure.com/api/retail/prices
- [2] Steamworks, Content Survey / AI disclosure: https://partner.steamgames.com/doc/gettingstarted/contentsurvey
- [3] PC Gamer, "Steam updates AI disclosure form to specify that it's focused on AI-generated content that is 'consumed by players'" (Jan 2026): https://www.pcgamer.com/software/ai/steam-updates-ai-disclosure-form-to-specify-that-its-focused-on-ai-generated-content-that-is-consumed-by-players-not-efficiency-tools-used-behind-the-scenes/
- [4] StraySpark, Steam 2026 AI disclosure guide (secondary): https://www.strayspark.studio/blog/steam-ai-disclosure-rules-2026-indie-developer-guide
- [5] ElevenLabs pricing: https://elevenlabs.io/pricing
- [6] ElevenLabs, "Can I publish the content I generate on the platform?": https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform
- [7] ElevenLabs Prohibited Use Policy (updated 17 Aug 2026): https://elevenlabs.io/use-policy
- [8] ElevenLabs Terms of Service, non-EEA (updated 31 Mar 2026): https://elevenlabs.io/terms-of-use
- [9] ElevenLabs, "Eleven v3 is Now Generally Available" / audio tags help: https://elevenlabs.io/blog/eleven-v3-is-now-generally-available , https://help.elevenlabs.io/hc/en-us/articles/35869142561297-How-do-audio-tags-work-with-Eleven-v3
- [10] ElevenLabs, Audio Tags list for Eleven v4: https://elevenlabs.io/blog/elevenlabs-audio-tags-list
- [10a] ElevenLabs, Voice remixing: https://elevenlabs.io/docs/capabilities/voice-remixing
- [11] Microsoft Learn, Limited Access: custom neural voice / personal voice (ms.date 2026-03-31): https://learn.microsoft.com/en-us/legal/cognitive-services/speech-service/custom-neural-voice/limited-access-custom-neural-voice
- [12] Inworld, "Migrate from PlayHT after shutdown"; Infrabase PlayHT entry: https://inworld.ai/resources/migrate-from-playht , https://infrabase.ai/audio/playht
- [13] coqui-ai/TTS Discussion #4304, XTTS-v2 commercial licence (reply 16 Feb 2026): https://github.com/coqui-ai/TTS/discussions/4304
- [14] PromptQuorum, Coqui XTTS v2 CPML guide 2026 (secondary): https://www.promptquorum.com/power-local-llm/local-tts-voice-cloning-piper-coqui-xtts
- [15] Kokoro-82M model card: https://huggingface.co/hexgrad/Kokoro-82M
- [16] Chatterbox model card: https://huggingface.co/ResembleAI/chatterbox
- [17] Chatterbox GitHub: https://github.com/resemble-ai/chatterbox
- [18] F5-TTS model card (CC-BY-NC-4.0): https://huggingface.co/SWivid/F5-TTS
- [19] StyleTTS2 GitHub: https://github.com/yl4579/StyleTTS2
- [20] Qwen3-TTS VoiceDesign model card: https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign
- [21] Qwen3-TTS GitHub: https://github.com/QwenLM/Qwen3-TTS
- [22] Zonos v0.1 model card: https://huggingface.co/Zyphra/Zonos-v0.1-transformer
- [23] Dia GitHub: https://github.com/nari-labs/dia
- [24] OpenAudio S1-mini model card (CC-BY-NC-SA-4.0): https://huggingface.co/fishaudio/openaudio-s1-mini
- [25] ElevenLabs, "What is a notice period?" (Voice Library): https://help.elevenlabs.io/hc/en-us/articles/33533163659921-What-is-a-notice-period
- [26] OpenAI Text-to-speech guide (voices, instructions, custom voices, disclosure requirement): https://developers.openai.com/api/docs/guides/text-to-speech
- [26a] OpenAI API pricing: https://developers.openai.com/api/docs/pricing
- [27] Google Cloud Text-to-Speech pricing: https://cloud.google.com/text-to-speech/pricing
- [28] Amazon Polly pricing: https://aws.amazon.com/polly/pricing/
- [29] Amazon Polly FAQs: https://aws.amazon.com/polly/faqs/
- [30] Resemble AI pricing: https://www.resemble.ai/pricing/
- [30a] Voiceflow, Resemble AI review 2026 (secondary, for TTS per-second and clone prices): https://www.voiceflow.com/blog/resemble-ai
- [31] Audacity FAQ: https://www.audacityteam.org/FAQ/
- [32] WellSaid pricing: https://wellsaid.io/pricing
- [32a] WellSaid Services Agreement (Online) / commercial-use help: https://www.wellsaid.io/wsa-online , https://help.wellsaidlabs.com/can-i-use-the-voices-for-commercial-use
- [33] Samson Q2U pack (Sweetwater) / Podcast Host review 2026: https://www.sweetwater.com/store/detail/Q2UPack--samson-q2u-recording-and-podcasting-pack-usb-xlr-dynamic-microphone-with-accessories , https://www.thepodcasthost.com/equipment/samson-q2u-podcasting-review/
- [34] Cartesia pricing: https://cartesia.ai/pricing
- [35] Cartesia Terms (dated 14 Jun 2024): https://cartesia.ai/legal/terms
- [36] European Commission, Quick facts: transparency rules for AI systems: https://digital-strategy.ec.europa.eu/en/factpages/quick-facts-transparency-rules-ai-systems
- [37] Jones Day, Draft Code of Practice on AI labelling (Jan 2026): https://www.jonesday.com/en/insights/2026/01/european-commission-publishes-draft-code-of-practice-on-ai-labelling-and-transparency
- [38] Hume AI pricing: https://www.hume.ai/pricing
- [39] Inworld pricing: https://inworld.ai/pricing
- [40] Fish Audio plans: https://fish.audio/plan/
- [41] US Copyright Office, Copyright and AI Part 2: Copyrightability (29 Jan 2025): https://www.copyright.gov/ai/ , https://copyright.gov/ai/Copyright-and-Artificial-Intelligence-Part-2-Copyrightability-Report.pdf
- [42] Orpheus 3B model card: https://huggingface.co/canopylabs/orpheus-3b-0.1-ft
- [43] NeuTTS Air model card: https://huggingface.co/neuphonic/neutts-air
- [44] Kyutai TTS 1.6B model card: https://huggingface.co/kyutai/tts-1.6b-en_fr
- [45] OHF-Voice piper1-gpl: https://github.com/OHF-Voice/piper1-gpl
- [46] Suno Bark GitHub: https://github.com/suno-ai/bark
- [47] Higgs Audio code licence (Apache-2.0): https://github.com/boson-ai/higgs-audio/blob/main/LICENSE
- [48] Higgs Audio v2 weights licence: https://huggingface.co/bosonai/higgs-audio-v2-generation-3B-base/blob/main/LICENSE
- [49] IndexTTS licence (bilibili Model Use License): https://raw.githubusercontent.com/index-tts/index-tts/main/LICENSE
- [50] Microsoft VibeVoice-1.5B model card: https://huggingface.co/microsoft/VibeVoice-1.5B
- [51] REAPER purchase page: https://www.reaper.fm/purchase.php
- [52] ReaPlugs: https://www.reaper.fm/reaplugs/
- [53] NO FAKES Act of 2026 (S.4591), reported by Senate Judiciary on 18 Jun 2026 and not yet law: https://www.govtrack.us/congress/bills/119/s4591/text , https://www.hklaw.com/en/insights/publications/2026/06/senate-judiciary-committee-advances-legislation-to-protect-name

## Appendix: voice-likeness legal risk

- **US.** The federal NO FAKES Act of 2026 passed the Senate Judiciary Committee on 18 Jun 2026 but is not law yet
  [53]. It would create federal voice-likeness rights with notice-and-removal. State right-of-publicity laws already
  apply.
- **EU.** AI Act Article 50 applies from 2 Aug 2026 [36].
- **How to stay safe:**
  - Use only your own voice, a purely designed synthetic voice, or a consenting person's voice.
  - Never prompt for, reference or clone a real performer.
  - Keep the consent notes and the reference audio hashes in the sidecars.
