# Objective — GCE A-Level Computer Science (0795)

**Status: ANCHORED.** Format and topic spine confirmed from the player's own scheme of
work and 2015–2025 past papers. This doc is the template for the other four GCE subjects.

## What mastery means
An A (top grade) on both papers. Concretely: every recurring skill below at strength 5,
and the player able to *produce* Paper 2 answers under time (show the working, not just
recognise the answer).

## The real exam format (confirmed)
- **Subject code:** 0795. Two papers.
- **Paper 1 — 50 MCQs**, four options (A–D) each, sweeping the whole syllabus in one
  pass: number systems, logic, architecture, OS, databases, networking, software
  engineering, data structures.
- **Paper 2 — 8 structured/essay questions**, each broken into (a)(b)(c) sub-parts worth
  2–8 marks. This paper demands *doing*: trace an algorithm pass by pass, draw a logic
  circuit from a truth table, draw an E-R diagram, write pseudocode with a named loop
  type, insert keys into a hash table with linear probing, convert floating-point,
  design test data (normal / boundary / erroneous).

Generate practice in BOTH shapes. For Paper 2, always require the working and mark
per-part with method marks.

## Topic spine — the player's 7 modules
1. **Computer Applications & socio-economic implications** — input/output/storage/
   communication devices; monitoring & control; simulation; batch vs online; ergonomics;
   green computing; legislation, copyright, data protection, privacy; open source;
   professional/ethical/moral obligations.
2. **Exploring Software** — system vs application software; utilities; OS functions;
   translators (compiler/interpreter/assembler) and compiler phases.
3. **Computer Networks, Data Communication & Security** — topologies; devices
   (hub/switch/router/repeater/gateway/modem); OSI/ISO layers; IP addressing & classes;
   MAC vs IP; protocols (FTP etc.); transmission modes (simplex/half/full duplex);
   threats & security.
4. **Data Structures & Algorithms** — arrays, records, stacks, queues, linked lists,
   trees; traversals; sorting (insertion, quick/divide-and-conquer); searching; hash
   tables & collision handling; pointers.
5. **Programming** — paradigms; pseudocode; loops (pre-test/post-test); functions &
   parameter passing (by value/reference); recursion; data types.
6. **Software Development** — SDLC (analysis, design, implementation, testing);
   waterfall vs prototyping; top-down/bottom-up; test data design; verification vs
   validation; feasibility; reliability.
7. **Computer Science Projects** — the practical/project component.

## Recurring skills (the spine of the mastery tracker)
These appear in nearly every year, numbers change but the skill repeats. Drill the
SKILL, not the specific question. Prime candidates for compounding.

- Number systems: decimal↔binary↔hex, fractional binary, **two's complement** arithmetic
  in an n-bit register, one's complement.
- Boolean algebra: derive expression from a truth table (sum-of-products), simplify,
  **draw the logic circuit**; gates in terms of NAND/NOR only; half/full adder.
- Architecture: addressing modes (immediate/direct/indirect/absolute); address & data
  bus width vs performance; fetch-execute cycle & registers; op-code/operand bit split
  → address range & op-code count; machine address types (0/1/2/3-address).
- Memory: bits to address an N×M memory (byte-addressable); virtual vs cache memory;
  paging/segmentation; frames/pages/segments.
- OS: process states & transitions; scheduling (FCFS, SJF, Round Robin) & waiting time;
  interrupts.
- Databases: normalization to 3NF; E-R diagrams & degree; entity/attribute modelling in
  `name(attr1, attr2, ...)` key-underlined format; SQL SELECT reasoning; relational vs
  flat-file; cardinality/degree/tuples.
- Data structures: **trace insertion sort** and state array after each pass; count
  comparisons; stack push/pop with a stack pointer; tree traversals (pre/in/post order);
  **hash insertion with linear probing** (h(k) = k mod m).
- Software engineering: SDLC stage descriptions; waterfall unsuitability; test-data
  design (normal/boundary/erroneous with reasons); verification vs validation.

## Quest generation
- **Weekday morning:** 1 focused drill on one recurring skill (a Paper-2-style "do it"
  task) + 3–5 Paper-1-style MCQs across mixed modules. Finishable in the window.
- **Weekend:** a longer mock — a full 50-MCQ set OR a 3–4 question Paper-2 block with
  full working, marked per-part.
- Rotate modules so no module goes cold. Pull the weakest / most-overdue `mastery`
  item first (compounding).

## Marking
- MCQ: right/wrong, but on wrong answers explain the trap and the correct reasoning.
- Structured: award method marks per sub-part; show the mark breakdown; name the exact
  step that lost a mark. Never accept a final answer without the working the paper asks
  for.

## Mastery items → `mastery/gce.json`
Seed one entry per recurring skill above under `subject: "computer-science"`, each with
`strength: 0`, `last_seen: null`, `next_due: null`. Raise strength on clean completion;
set `next_due` further out as strength climbs (spaced repetition).
