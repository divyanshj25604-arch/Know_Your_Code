# KNOW YOUR CODE
## Product Requirements, UX & UI Specification
**Version:** 1.0  
**Document purpose:** Single source of truth for the coding agent  
**Product:** Know Your Code  
**Tagline:** Understand the code you ship.  
**Supporting line:** Your repository becomes your textbook.

---

# 1. HOW TO USE THIS DOCUMENT

This document defines what Know Your Code must feel like, what users must be able to do, how the product should behave, and what the interface must communicate.

The coding agent must treat this document as the product specification, not as a loose collection of suggestions.

### Priority hierarchy

When making product decisions, follow this order:

1. User journey continuity and UX correctness.
2. MVP requirements explicitly marked as required.
3. Code understanding and learning experience.
4. Accuracy, evidence and transparency.
5. Visualizations and interactive exploration.
6. Brand consistency and visual polish.
7. Secondary enhancements.

A visually attractive screen that breaks the user's journey is not acceptable.

A graph that looks impressive but misrepresents relationships is not acceptable.

An AI explanation that sounds confident but cannot show its evidence is not acceptable.

### Scope labels

- **MVP REQUIRED:** Must work in the MVP.
- **MVP SIMPLIFIED:** Must exist, but can have reduced depth.
- **POST-MVP:** Not required for the current submission.
- **LONG-TERM:** Part of the complete product vision.

Do not silently promote postponed features into the MVP.

---

# 2. PRODUCT VISION

## 2.1 What is Know Your Code?

Know Your Code is an interactive software learning environment that transforms a user's existing software project into a structured, visual and guided learning experience.

It helps users understand:

- What their application does.
- How the application is organised.
- Why individual files and functions exist.
- How different parts of the application connect.
- How a user action travels through the application.
- Where data comes from and where it goes.
- Which technologies and concepts are used.
- How to explain and work with their own code independently.

The user's repository is the primary learning material.

The product does not teach programming through an unrelated collection of generic examples. It starts with the application the user wants to understand.

## 2.2 The central problem

Students and developers often work with codebases they cannot fully explain.

They may be able to run an application, modify a component, or use AI to generate functionality, but struggle to answer:

- What happens when someone clicks this button?
- Which function handles this request?
- Where does this data come from?
- Why does this file exist?
- What happens if this function fails?
- How does the frontend communicate with the backend?
- Which database operation is involved?
- What would I need to change to modify this feature?

Know Your Code turns these questions into a structured exploration experience.

## 2.3 Product promise

A user should be able to move from:

"I have this repository, but I don't understand how it works."

To:

"I understand the application structure, can trace important flows, can navigate the relevant code, and can explain what happens and why."

The initial experience should help a user build a useful mental model quickly. Deeper understanding develops through continued exploration.

## 2.4 What Know Your Code is not

Know Your Code is not:

- A code generator.
- A generic chatbot attached to a code editor.
- A conventional programming course.
- A code grading platform.
- A linter.
- A repository summarisation tool with no interactive exploration.
- An AI oracle that claims to know things it cannot verify.

The product explains and teaches existing code. It does not replace the user's thinking.

---

# 3. PRODUCT PRINCIPLES

These principles govern every screen and interaction.

## 3.1 Evidence first

Every explanation must be grounded in the actual repository wherever possible.

A user must be able to move from an explanation to the source file and relevant line.

## 3.2 One important thing at a time

The interface should guide attention.

Avoid displaying every file, relationship, metric and explanation simultaneously.

Use progressive disclosure. Show the overview first, then let users explore deeper levels.

## 3.3 Their code, their pace

Users must be free to explore different areas of the application.

Do not force them through a rigid linear curriculum.

The product can recommend a learning path, show what has been explored, and identify useful next steps. It must not prevent users from navigating elsewhere.

## 3.4 Explain before evaluating

Never make users feel incompetent for not understanding something.

Introduce the concept, show the relevant code, explain the behaviour, and then offer a way to check understanding.

## 3.5 Admit uncertainty

The product must distinguish between:

- What is directly verified.
- What is likely based on available evidence.
- What cannot currently be established.

Uncertainty must be visible and understandable.

## 3.6 Visual understanding matters

Architecture maps, application flows, file relationships and code connections are core product experiences.

They are not decorative additions.

## 3.7 Learning before AI

AI supports the learning experience. It must not become the entire learning experience.

The product should provide structure, visual explanations, source references and guided exploration even when an AI explanation is not available.

---

# 4. USERS AND THEIR NEEDS

## 4.1 Primary audiences

### Students

Students who build projects, use existing codebases, participate in hackathons, prepare for vivas or interviews, and need to understand the code they have worked with.

Their needs:

- Understand an unfamiliar repository.
- Learn concepts using actual code.
- Prepare to explain project decisions.
- Understand frontend, backend and database relationships.
- Navigate files without getting lost.
- Identify important areas to study.

### Developers

Developers who join an existing project, explore unfamiliar repositories, review application architecture or need to understand how a feature works.

Their needs:

- Quickly understand project structure.
- Identify important modules and dependencies.
- Trace execution paths.
- Find relevant files and functions.
- Understand unfamiliar technologies.
- Investigate how a change may affect connected parts.

The interface should serve both audiences without creating two unrelated products.

---

# 5. MVP SCOPE AND LOCKED DECISIONS

## 5.1 Decisions locked for this MVP

1. The MVP is a desktop application connected to cloud services.
2. Shared product capabilities are developed first.
3. Cloud execution is the only runtime included in the MVP.
4. Local runtime is postponed.
5. The long-term product must remain compatible with a future local runtime.
6. The repository is the primary learning material.
7. GitHub import is required.
8. ZIP import is part of the intended product journey and should be included where feasible.
9. JavaScript and TypeScript are the initial language priorities.
10. The product must support both overview-level and deeper code exploration.
11. Application-flow-based learning is the primary learning organisation.
12. Concepts and technologies support the application-flow learning experience.
13. Users can explore freely instead of being forced through a linear course.
14. The project workspace is the main home of the learning experience.
15. A conventional analytics dashboard is not the primary product experience.
16. Graphs, maps and visual explanations are important product surfaces.
17. Explanations must connect to actual repository evidence.
18. The product must distinguish verified, likely and unknown information.
19. The MVP must prioritise a complete working user journey over an oversized feature list.

## 5.2 Seven product modules

The complete product contains seven modules:

1. Import
2. Analysis
3. Orientation
4. Explore
5. Learn
6. Experiment
7. Assess

### MVP module status

| Module | MVP status |
|---|---|
| Import | Required |
| Analysis | Required |
| Orientation | Required |
| Explore | Required |
| Learn | Required, focused version |
| Experiment | Deferred entirely |
| Assess | Simplified and optional |

**Experiment must not appear as an unfinished, disabled or partially working MVP feature.**

It remains documented as a future product module.

## 5.3 MVP priorities

### Essential

- Import a repository.
- Understand the analysis progress.
- View project overview.
- Explore project structure.
- View important files and symbols.
- Explore architecture relationships.
- View candidate application flows.
- Open source code from graph elements.
- Select a line and understand it.
- Access contextual explanations.
- Ask questions about the repository.
- See citations and confidence indicators.
- Navigate without losing context.

### Simplified

- Guided learning.
- Concept primers.
- Learning recommendations.
- Progress tracking.
- Optional knowledge checks.
- Deep application-flow analysis.

### Deferred

- Experiment module.
- Interactive execution simulations.
- Runtime execution tracing.
- Full adaptive learning.
- Advanced practical challenges.
- Comprehensive assessment engine.
- Local-only runtime and privacy mode.

---

# 6. COMPLETE USER JOURNEY

The user's journey is the most important part of this product.

Every transition must feel intentional. A user must always understand:

- Where they are.
- What they are looking at.
- What they can do next.
- How to return to their previous context.

## Stage 1: First launch

**MVP REQUIRED**

The first screen should immediately communicate what the product does.

### Main message

"Understand the code you ship."

Supporting text:

"Your repository becomes your textbook."

Additional explanation:

"Paste a GitHub repository. We'll map your project, explain how its parts connect, and help you understand the code behind it."

### Main action

A single prominent repository input.

Placeholder:

`https://github.com/you/your-project`

Primary button:

"Map my repo"

Secondary option:

"Upload ZIP"

### Visual composition

- Brand identity at the top.
- Main promise on the left.
- A real-looking code explanation preview on the right.
- One highlighted code line.
- One visible source citation.
- No unnecessary dashboard cards.
- No decorative AI illustrations.

### First-launch behaviour

The user should be able to start without completing a lengthy onboarding questionnaire.

Do not force users to choose their skill level, preferred language or learning style before they can import a project.

---

## Stage 2: Repository import

**MVP REQUIRED**

The user provides a GitHub URL or ZIP file.

The experience must clearly communicate:

- What repository is being imported.
- Whether it is accessible.
- Whether the project can be analysed.
- What happens next.

### Import states

1. Empty input.
2. Valid input.
3. Invalid URL.
4. Repository unavailable.
5. Private repository.
6. Import in progress.
7. Import complete.
8. Import failed.

### Example messages

Invalid URL:

"We couldn't recognise this as a GitHub repository link. Check the URL and try again."

Private repository:

"This repository is private. Make it public or connect an authorised GitHub account."

Import progress:

"Getting your project ready..."

Import complete:

"Project imported. We're preparing its structure."

Never leave users staring at a blank loading screen.

---

## Stage 3: Analysis progress

**MVP REQUIRED**

Analysis should feel like a visible process, not an unexplained waiting period.

Display a clear sequence:

1. Reading repository files.
2. Identifying languages and dependencies.
3. Mapping files and symbols.
4. Connecting relationships.
5. Identifying application entry points.
6. Preparing the project overview.

The progress screen should communicate what the system is doing in plain language.

### Required behaviours

- Show the current stage.
- Show completed stages.
- Show any skipped or unsupported files.
- Explain limitations.
- Allow users to leave and return to the project.
- Preserve completed analysis.
- Avoid presenting speculative results as verified facts.

Example:

"Reading 142 files..."

"Mapping how your components connect..."

"Your project map is ready."

### Partial analysis

If some files cannot be analysed, the entire project must not become unusable.

Display a clear warning:

"3 files were too large to parse. Explanations for these files may be limited."

Allow users to continue with the available information.

---

## Stage 4: Project orientation

**MVP REQUIRED**

This is the first major learning moment.

After analysis, the user should understand the shape of the application before exploring individual functions.

The orientation experience should answer:

1. What is this project?
2. What does it appear to do?
3. What technologies does it use?
4. What are its major modules?
5. How are those modules connected?
6. Where should the user start exploring?

### Orientation layout

The page should have:

- Project identity and description.
- Technology stack.
- Project architecture map.
- Major module descriptions.
- Important entry points.
- Recommended starting points.
- A clear action to begin exploring.

### Project summary

Use plain language.

Avoid generic descriptions such as:

"This is a modern full-stack application."

Prefer:

"This application provides a login system, stores user records, and creates sessions after successful authentication."

Every factual claim should have supporting evidence when available.

### Technology overview

Display technologies as compact tags.

Examples:

React, Express, PostgreSQL, Prisma, Node.js.

Selecting a technology should reveal:

- What it does in this repository.
- Which files use it.
- Why it appears relevant.
- Related concepts the user may want to learn.

### Architecture map

The map must communicate major application areas and their relationships.

Do not show every variable and function at this level.

Users should be able to select a module and move deeper.

### Recommended starting points

Provide a small number of meaningful recommendations.

Example:

"Start with src/index.ts. It is where the application begins."

"Next, explore routes/auth.ts to understand authentication."

Recommendations must be grounded in the repository.

---

## Stage 5: Explore the repository

**MVP REQUIRED**

This is the central workspace.

The user must be able to move between:

- Project overview.
- File structure.
- Architecture.
- Application flows.
- Source code.
- Explanations.
- Learning material.

### Navigation

Use a clear, persistent project navigation system.

Primary sections:

- Overview
- Files
- Request Flow
- Primers

The exact visual treatment must follow the brand kit.

Do not introduce unrelated dashboard sections.

### File explorer

Display the repository's structure in a readable tree.

Users should be able to:

- Expand and collapse folders.
- Select files.
- See relevant file metadata.
- Identify important files.
- Open source code.
- See relationships to other files.

Avoid showing irrelevant generated or dependency folders as primary content.

### Code viewer

The code viewer is a major product surface.

It must include:

- File path.
- Line numbers.
- Syntax highlighting.
- Selected-line highlighting.
- Clear current-file state.
- Relationship and citation navigation.

Users should be able to select a line and open its explanation.

The selected line must be visually distinct.

Do not highlight several unrelated sections simultaneously.

### File relationships

Users should be able to understand:

- What imports a file.
- What a file imports.
- Which functions call another function.
- Which routes handle requests.
- Which components render other components.
- Which functions interact with data models.

Only show relationships supported by available evidence.

---

## Stage 6: Understand application flows

**MVP REQUIRED, focused version**

The application-flow experience is a core differentiator.

Users should be able to follow a feature through the application.

Example: Login flow.

1. User submits the login form.
2. Frontend event handler runs.
3. Request is sent to the backend.
4. Backend route receives the request.
5. Authentication function is called.
6. Database lookup occurs.
7. Password verification happens.
8. Session is created or an error is returned.

The actual steps must depend on the repository.

Do not use the example above as a fixed template for every project.

### Flow visualization

A flow should display:

- Ordered steps.
- The relevant file and function.
- Direction of movement.
- Important data passed between steps.
- Branches where evidence supports them.
- Database or external-service interactions.
- Unresolved relationships.

### Interactions

Selecting a flow step should:

- Highlight the relevant node.
- Show a short explanation.
- Show the source file and line.
- Allow the user to open the actual code.
- Show connected previous and next steps.

Users must be able to move between the visual flow and source code without losing their place.

### Graph behaviour

The graph must not become an unreadable network of hundreds of nodes.

Use progressive levels:

1. Application-level overview.
2. Module-level relationships.
3. File-level relationships.
4. Function-level relationships.

Users should be able to zoom, pan, select and drill down.

Provide a clear way to return to the parent level.

### Relationship types

The interface may display:

- Imports
- Calls
- Exports
- Uses
- Handles
- Queries
- Renders
- Sends request to

Each relationship must have an understandable visual meaning.

Do not rely on colour alone to communicate relationship type.

---

# 7. THE SEVEN PRODUCT MODULES

This section defines the complete product, including modules deferred from the MVP.

## MODULE 1: IMPORT

**MVP REQUIRED**

### Purpose

Bring the user's existing project into the learning environment.

### User actions

- Paste a GitHub repository URL.
- Upload a ZIP archive.
- Confirm the selected project.
- Start analysis.

### Required experience

Import must be simple and predictable.

Users should not need to understand repository internals to get started.

### Success condition

The user knows which project has been imported and can proceed to analysis.

---

## MODULE 2: ANALYSIS

**MVP REQUIRED**

### Purpose

Understand the structure and relationships within the repository.

### Information to identify

- Languages.
- Frameworks.
- Dependencies.
- Files and folders.
- Functions and classes.
- Components.
- Imports and exports.
- Function relationships.
- Routes.
- Database models.
- Important entry points.
- Candidate application flows.

### User-facing experience

Analysis results should be understandable and navigable.

Do not dump raw analysis output onto the user.

Translate structural information into meaningful project understanding.

### Progressive analysis

The user should receive useful information as it becomes available.

The initial overview should not require every deep explanation to be completed.

### Success condition

The system has produced a useful representation of the repository that users can explore.

---

## MODULE 3: ORIENTATION

**MVP REQUIRED**

### Purpose

Give users a mental model of the application.

### Required outputs

- Project summary.
- Technology stack.
- Major modules.
- Architecture overview.
- Important entry points.
- Recommended exploration order.
- Clickable architecture map.

### Success condition

A user can explain what the project broadly does and identify where to start.

---

## MODULE 4: EXPLORE

**MVP REQUIRED**

### Purpose

Allow users to investigate the actual repository.

### Required experiences

- File explorer.
- Code viewer.
- Architecture graph.
- File relationship exploration.
- Function-level navigation.
- Application-flow navigation.
- Explain This Line.

### Success condition

A user can move from a visual representation to the actual source code and understand how connected parts relate.

---

## MODULE 5: LEARN

**MVP REQUIRED, FOCUSED VERSION**

### Purpose

Turn repository exploration into structured learning.

Learning must be connected to the user's actual application.

### Learning organisation

The primary organisation is application-flow based.

Concepts and technologies support the flow.

For example:

Primary topic: Understand login.

Supporting concepts:

- HTTP requests.
- Routes.
- Middleware.
- Async/await.
- Database queries.
- Authentication.
- Sessions.

### Learning content format

A learning unit should combine:

1. What the application is doing.
2. Why this part exists.
3. Which files are involved.
4. The relevant source code.
5. How the pieces connect.
6. Supporting technical concepts.
7. A suggested next exploration.

### Guided and free exploration

Users should be able to follow recommendations or explore independently.

Do not lock the next lesson until the previous lesson is complete.

### Concept primers

Primers should be short, focused and repository-specific.

The brand kit defines a two-minute primer format:

1. Concept title.
2. Explanation of no more than 60 words.
3. Code example from the repository when possible.
4. Everyday analogy.
5. Repository link with counted occurrences.

Example concept: async/await.

Explain the actual use of await in the selected repository before introducing a general analogy.

### Learning recommendations

Recommendations should explain why a topic is relevant.

Example:

"Learn middleware next. Your authentication route uses it before handling login requests."

Do not generate generic recommendations unrelated to the project.

### Success condition

The user understands more about their own application and can navigate its important parts.

---

## MODULE 6: EXPERIMENT

**LONG-TERM ONLY. DEFERRED FROM MVP.**

This module is part of the long-term product vision.

It must not be implemented as an incomplete feature in the current MVP.

### Purpose

Allow users to test their understanding by interacting with simplified representations of their own code.

Potential future experiences:

- Simulate the movement of data through a flow.
- Explore conditional branches.
- Change hypothetical input values.
- Observe how different paths behave.
- Understand the effects of a function's output.
- Investigate dependencies between components.
- Complete guided code-exploration missions.

### Product principles

Experiment must be educational, not a decorative animation.

Every simulation must explain what is being represented and what is not.

A simulation must not pretend to be actual runtime execution unless it is genuinely backed by runtime evidence.

### Future success condition

Users can actively explore how their application behaves rather than only reading explanations.

---

## MODULE 7: ASSESS

**MVP SIMPLIFIED; FULL VERSION LONG-TERM**

### Purpose

Help users check whether they understand the code they have explored.

### MVP experience

Optional, low-pressure knowledge checks.

Examples:

- What does this function return?
- Which route calls this function?
- Where does this value originate?
- What happens if this condition is false?
- Which component sends this request?

### Knowledge check presentation

Questions should be connected to actual repository code.

Show the correct answer with a source reference.

Example:

Question:

"What does this function return if no user matches?"

Answer:

"null, then the caller handles the missing user."

Show the relevant source citation.

### Long-term assessment

Potential future assessment experiences:

- Explain a function in your own words.
- Trace an application flow.
- Identify the source of a bug.
- Explain a dependency.
- Defend an architectural decision.
- Solve practical code-understanding challenges.
- Prepare for a viva or technical interview.

### Assessment principles

- Never shame users.
- Never publicly grade or rank users.
- Do not make a single score represent complete code understanding.
- Explain why an answer is correct.
- Identify specific gaps that users can explore.

---

# 8. LEARNING EXPERIENCE AND PARAMETERS

The product should support the following seven dimensions of learning. These are product-design dimensions, not seven separate mandatory screens.

## 8.1 Application understanding

Can the user explain what the application does?

## 8.2 Structural understanding

Can the user identify the major modules, files and responsibilities?

## 8.3 Relationship understanding

Can the user explain how different parts connect?

## 8.4 Execution-flow understanding

Can the user follow what happens when a user action or request occurs?

## 8.5 Conceptual understanding

Can the user understand the technologies and programming concepts used in their project?

## 8.6 Code-level understanding

Can the user explain individual functions, statements, inputs, outputs and dependencies?

## 8.7 Practical and explanatory confidence

Can the user explain the application, navigate its code and reason about changes independently?

### Important distinction

These dimensions should inform learning recommendations and progress representation.

They must not be presented as a fabricated competency score.

Progress should be based on actual user activity and demonstrated understanding.

### Learning progression

The intended progression is:

1. Understand the application.
2. Understand its structure.
3. Explore important modules.
4. Trace application flows.
5. Learn supporting concepts.
6. Understand individual code sections.
7. Explain and assess understanding.

This is a recommended path, not a forced sequence.

---

# 9. THE DEFINING EXPERIENCE: EXPLAIN THIS LINE

This is one of the most important interactions in Know Your Code.

The brand kit explicitly identifies it as the core moment.

**MVP REQUIRED**

When a user selects a line of code, an explanation panel should answer five questions.

## 9.1 What it does

Explain the selected line or function in plain language.

Lead with the actual behaviour.

## 9.2 Where its data comes from

Explain the origin of important values.

Show the relevant source file and line.

## 9.3 What calls it

Show callers and relevant relationships.

If the system cannot establish a caller, say so.

## 9.4 What breaks if it fails

Explain the known consequences of failure.

Do not invent downstream effects.

## 9.5 What to explore next

Show related functions, concepts, files or a short primer.

### Panel layout

The panel should include:

- Selected file and line.
- Verification status.
- What it does.
- Where its data comes from.
- What calls it.
- What breaks if it fails.
- Related source citations.
- Relevant concept primer.
- Optional understanding check.

### Citation behaviour

Every source-backed explanation should include a clickable citation.

Selecting the citation should open the relevant file at the relevant line.

### Confidence labels

Use three explicit states:

**VERIFIED**

The relationship is directly supported by parser evidence or source structure.

**LIKELY**

The explanation is inferred from available evidence. Include citations and explain the inference.

**NOT SURE**

The system cannot verify the relationship. Explain what is missing and where the user might investigate.

Confidence must never be communicated through colour alone.

Use a glyph, written label and border treatment.

---

# 10. VISUALIZATION REQUIREMENTS

Visualizations are essential product experiences.

They must be useful, interactive, readable and grounded in repository evidence.

## 10.1 Project architecture map

**MVP REQUIRED**

Shows the major application areas and their relationships.

Requirements:

- Clear hierarchy.
- Meaningful node labels.
- Understandable connectors.
- Clickable nodes.
- Ability to drill down.
- Source references.
- Clear parent-level navigation.
- No unnecessary graph clutter.

## 10.2 Repository structure map

**MVP REQUIRED**

Shows the directory and file organisation.

Requirements:

- Expandable folders.
- Clear file labels.
- Important files identifiable.
- File selection.
- Connections to related code where useful.

## 10.3 Application request-flow graph

**MVP REQUIRED, FOCUSED**

Shows how a request travels through the application.

Requirements:

- Ordered flow steps.
- Directional connectors.
- Source file and line.
- Clickable nodes.
- Previous and next relationships.
- Branches where supported.
- Database and external-service interactions where supported.
- Explicit unresolved steps.

## 10.4 Function relationship graph

**MVP SIMPLIFIED**

Shows how functions call or depend on one another.

Users should be able to select a function and see relevant callers and dependencies.

Avoid showing the entire repository's call graph at once.

## 10.5 Graph interaction rules

All important graphs must support:

- Selection.
- Hover information.
- Zoom.
- Pan.
- Clear focus state.
- Click-through to source code.
- Context-preserving navigation.
- A visible way to return to the previous level.

## 10.6 Visual accuracy

Never draw a relationship just to make a graph appear complete.

Differentiate:

- Directly observed relationships.
- Inferred relationships.
- Unknown relationships.

A missing edge is better than a fabricated edge.

## 10.7 Graph readability

Avoid:

- Excessive node density.
- Overlapping labels.
- Unclear connector directions.
- Too many simultaneous colours.
- Unexplained abbreviations.
- Decorative animations that interfere with understanding.

---

# 11. MAIN UI STRUCTURE

The product should feel like a focused learning workspace.

It should not feel like an analytics dashboard.

## 11.1 Main navigation

The project workspace should provide access to:

- Overview
- Files
- Request Flow
- Primers

Additional learning and assessment interactions should appear contextually where they are relevant.

Do not introduce an oversized navigation system.

## 11.2 Workspace layout

The workspace should maintain three conceptual areas:

**Navigation area**

Project sections and repository structure.

**Main content area**

The current graph, file, flow or learning content.

**Contextual explanation area**

Explanations, source evidence, concepts and related information.

These areas must adapt to the current activity.

Do not force every screen into a rigid three-column layout if it harms readability.

## 11.3 Persistent context

The user should not lose their place when moving between:

- Graph and source code.
- Source code and explanation.
- Flow and related function.
- Primer and repository example.

Provide clear back navigation and preserve the relevant selected context.

---

# 12. SCREEN-BY-SCREEN REQUIREMENTS

## Screen A: Welcome / Import

**MVP REQUIRED**

Contains:

- Brand lockup.
- Main promise.
- Supporting line.
- GitHub URL input.
- Map my repo button.
- ZIP upload option.
- Brief explanation of what happens after import.

Primary action must be obvious.

## Screen B: Import progress

**MVP REQUIRED**

Contains:

- Project name.
- Import status.
- Current activity.
- Progress feedback.
- Clear error or success message.

## Screen C: Analysis progress

**MVP REQUIRED**

Contains:

- Analysis stages.
- Completed stages.
- Current stage.
- Warnings and skipped files.
- Clear progress messaging.

## Screen D: Project overview

**MVP REQUIRED**

Contains:

- Project name.
- Project description.
- Technology stack.
- Architecture map.
- Major modules.
- Important entry points.
- Recommended starting points.

This screen establishes the user's mental model.

## Screen E: File explorer

**MVP REQUIRED**

Contains:

- Repository tree.
- Selected file.
- Code viewer.
- File metadata.
- Relevant relationships.
- Explanation entry point.

## Screen F: Request flow

**MVP REQUIRED, FOCUSED**

Contains:

- Selected application flow.
- Ordered steps.
- Graph connectors.
- Source references.
- Step explanations.
- Navigation to code.

## Screen G: Explain This Line

**MVP REQUIRED**

Contains:

- Selected code line.
- Five explanation questions.
- Source citations.
- Confidence status.
- Related concepts.
- Optional knowledge check.

## Screen H: Concept primer

**MVP REQUIRED, FOCUSED**

Contains:

- Concept title.
- Short explanation.
- Repository-specific code.
- Analogy.
- Related occurrences.
- Link to the relevant source.

## Screen I: Knowledge check

**MVP SIMPLIFIED**

Contains:

- One focused question.
- A small number of answer choices or an explanation prompt.
- Feedback.
- Correct answer.
- Supporting source reference.

Must remain optional.

## Screen J: Project learning progress

**MVP SIMPLIFIED**

Progress should be shown in the context of the project.

Possible indicators:

- Explored modules.
- Viewed important flows.
- Read concept primers.
- Completed knowledge checks.
- Areas still worth exploring.

Do not create a large analytics dashboard.

Do not invent a percentage that claims to measure total code understanding.

---

# 13. INTERACTION AND NAVIGATION RULES

These rules apply across the entire application.

1. Every clickable graph node must have a meaningful action.
2. Every source citation must open the correct source location.
3. Every selected file must have a clear selected state.
4. Every selected code line must be visually identifiable.
5. Every graph must have a clear way to return to its parent view.
6. Loading states must explain what is happening.
7. Errors must explain what happened and what the user can do.
8. Failed analysis of one file must not unnecessarily block the entire project.
9. Switching between code and explanation must preserve context.
10. Navigation must not silently discard user progress.
11. No important feature should exist only as an inert visual element.
12. Disabled actions must explain why they are unavailable.
13. Tooltips should explain unfamiliar controls.
14. Keyboard focus must be visible.
15. The product must not require users to understand its internal terminology before using it.

---

# 14. EMPTY, LOADING, SUCCESS AND ERROR STATES

Every major screen must be designed for more than its ideal state.

## Empty states

Examples:

No project:

"Paste a GitHub link to start mapping your project."

No selected file:

"Select a file to explore what it does."

No flow found:

"We couldn't identify a complete request flow yet. You can still explore the files and relationships we found."

No primer:

"We haven't prepared a primer for this concept yet."

## Loading states

Use plain language.

Examples:

"Reading repository files..."

"Mapping how functions connect..."

"Preparing your project overview..."

Avoid vague loading labels such as "Processing..." when a more useful description is available.

## Success states

Examples:

"Project imported."

"Your project map is ready."

"Mapped. Start with src/index.ts, where requests begin."

## Error states

Every error should explain:

1. What happened.
2. Why it may have happened.
3. What the user can do next.

Example:

"We couldn't reach GitHub. Check your connection and try again."

Never blame the user.

---

# 15. BRAND AND VISUAL DESIGN REQUIREMENTS

The KnowYourCode Brand Kit v1.0 is the visual authority.

Do not invent a competing visual identity.

## 15.1 Brand identity

Name:

KnowYourCode in the wordmark.

Use "Know Your Code" in running text.

Tagline:

"Understand the code you ship."

Supporting line:

"Your repository becomes your textbook."

Never use "KYC" as the spoken or written product name.

## 15.2 Core visual materials

The visual identity is based on:

**Ink**

Code, technical substance and depth.

**Paper**

Learning, explanation and readable content.

**Highlighter**

The one important line or idea.

**Citation Teal**

Evidence and references. It is not decorative colour.

## 15.3 Exact palette

- Ink Deep: #0B1120
- Ink: #0F172A
- Ink Raised: #1E293B
- Paper: #FAF7F0
- Slate Muted: #94A3B8
- Highlighter: #FACC15
- Citation Teal: #2DD4BF

Semantic interface colours:

- Success: #22C55E
- Warning: #FB923C
- Error: #F87171
- Information: #60A5FA

Semantic colours are for interface status only.

## 15.4 Colour proportions

For the product interface, the brand kit specifies approximately:

- 78% Ink and dark surfaces.
- 18% Paper and neutrals.
- 2% Highlighter.
- 2% Citation Teal.

Yellow should be rare enough to communicate importance.

Teal should become more visible when evidence and citations are present, not as decoration.

## 15.5 Typography

Use the following typefaces:

**Manrope**

Display text and headings.

**Inter**

Body copy, labels, buttons, tables and interface text.

**JetBrains Mono**

Code, citations, file paths, line numbers and technical labels.

### Screen typography scale

- Display: 56/60px, Manrope 800.
- H1: 40/44px, Manrope 800.
- H2: 30/36px, Manrope 700.
- H3: 22/28px, Manrope 700.
- H4: 18/24px, Manrope 700.
- Body large: 18/28px, Inter 400.
- Body: 16/24px, Inter 400.
- Body small: 14/20px, Inter 400.
- Caption: 12/16px, Inter 500.
- Eyebrow: 12/16px, JetBrains Mono 500.
- Code: 14/22px, JetBrains Mono 400.

Body text should not fall below 14px in the product UI.

## 15.6 Shape and spacing

- Control radius: 6px.
- Container radius: 8px.
- Pill shapes only for tags.
- Use a 4px spacing base.
- Focus ring: 2px Highlighter with 2px offset.
- Avoid decorative shadows.
- Use surface colour and borders for hierarchy.

## 15.7 Buttons

Primary:

- Highlighter background.
- Ink Deep text.
- Inter 600, 14px.
- 10px vertical and 16px horizontal padding.
- Maximum one primary button per view.

Secondary:

- 1px Slate Muted border.
- Paper text.
- Ink Raised hover background.

Avoid oversized pill-shaped buttons.

## 15.8 Navigation

Inactive:

Slate Muted.

Active:

Paper text, weight 600, with a 2px Highlighter underline.

Hover:

Paper text.

## 15.9 Citation chips and tags

Technology tags:

- Ink Raised background.
- Paper text.
- Pill shape.

Citation chips:

- Citation Teal.
- Clearly distinguishable from ordinary tags.
- Clickable.
- Must open the source location.

## 15.10 Light mode

Light mode may be supported, but dark mode is the default design priority.

In light mode:

- Background: Paper.
- Main text: Ink.
- Secondary text: #475569.
- Citation text: Ink.
- Citation rule: #0D9488.

Never use Highlighter yellow or Citation Teal as normal text on Paper.

## 15.11 Prohibited visual treatments

Do not use:

- Gradients.
- Glows.
- Decorative shadows.
- Stock photos.
- Brains, circuits or generic AI illustrations.
- Unapproved logo variations.
- Yellow text on Paper.
- Teal for success indicators or decoration.
- Multiple competing highlights.
- Excessive rounded consumer-app styling.

## 15.12 Highlighting rule

One highlighted line or phrase per view.

A screen where everything is highlighted communicates nothing.

---

# 16. BRAND VOICE AND PRODUCT LANGUAGE

The product should sound like a knowledgeable, patient senior developer sitting beside the learner.

### Voice principles

1. Explain before evaluating.
2. Be specific.
3. Use plain language.
4. Show evidence.
5. Admit uncertainty.
6. Encourage exploration.
7. Never shame AI use.

### Preferred language

- Trace.
- Follow.
- Walk through.
- Map.
- This line.
- This function.
- Your repository.
- Here's what we found.
- Based on file:line.
- Calls.
- Reads.
- Returns.
- Depends on.

### Avoid

- Obviously.
- Just.
- Simply.
- Basic.
- Easy.
- Revolutionary.
- Next-generation.
- Supercharge.
- Magic.
- The AI thinks.
- Cheating.
- Clueless.

### Explanation structure

Lead with what the code does, then explain why.

Use one idea per sentence.

Use real technical terminology and explain it once.

Show the repository code first, introduce the concept second, and use an analogy third.

---

# 17. ACCESSIBILITY AND USABILITY

The interface must remain usable during long code-reading sessions.

Requirements:

- Maintain readable contrast.
- Do not use colour as the only status indicator.
- Provide visible keyboard focus.
- Make graph controls understandable.
- Use readable labels.
- Avoid unnecessarily small text.
- Maintain consistent navigation.
- Support keyboard access for important interactions.
- Make selected nodes and lines visually distinct.
- Ensure graph information is also available in a readable textual form.
- Do not use animation that makes it difficult to follow a flow.

Accessibility overrides aesthetics.

---

# 18. MVP ACCEPTANCE CRITERIA

The MVP should be considered successful only when the following user journey works.

## Import

- User can provide a supported repository.
- The selected project is clearly identified.
- Errors are understandable.
- Import status is visible.

## Analysis

- Analysis progress is visible.
- The user receives useful project information.
- Unsupported files are reported.
- Partial analysis does not unnecessarily block the project.

## Orientation

- User can see the project overview.
- Technology stack is identifiable.
- Major modules are understandable.
- Architecture map is interactive.
- Important starting points are visible.

## Explore

- User can navigate the file tree.
- User can open source code.
- User can identify important functions.
- Relationships are navigable.
- Graph elements lead to relevant source code.

## Application flows

- User can explore at least one useful candidate flow in a supported project.
- Flow steps are ordered.
- Relevant files and lines are visible.
- Unknown relationships are not fabricated.

## Explain This Line

- User can select a code line.
- The explanation panel opens.
- The five explanation questions are represented.
- Source citations are clickable.
- Confidence is communicated clearly.

## Learn

- User can access a relevant concept primer.
- The primer uses actual repository context where possible.
- User can move from the primer back to source code.
- Learning recommendations are relevant.

## Assess

- An optional knowledge check can be completed.
- Feedback explains the answer.
- The answer is connected to source evidence.
- No public grading or shaming occurs.

## Overall UX

- No broken navigation.
- No dead interactive controls.
- No unexplained blank states.
- No loss of selected context during navigation.
- No misleading graphs.
- No unsupported claims presented as verified facts.

---

# 19. PRIORITY WHEN TIME IS LIMITED

If the coding agent cannot complete every detail within the MVP deadline, it must preserve the following order.

### Priority 1: Complete user journey

Import → Analysis → Orientation → Explore.

### Priority 2: Visual understanding

Architecture map, file relationships and one useful application flow.

### Priority 3: Explain This Line

The five-question explanation experience with source citations.

### Priority 4: Learning

Repository-specific primers and contextual explanations.

### Priority 5: Optional assessment

Basic knowledge checks.

### Do not sacrifice

- Navigation correctness.
- Source citations.
- Graph accuracy.
- Clear analysis states.
- Readable code.
- Consistent visual hierarchy.
- The user's ability to understand where they are.

A complete, reliable journey is more valuable than ten disconnected features.

---

# 20. FINAL INSTRUCTIONS TO THE CODING AGENT

Build Know Your Code as a learning environment, not as a generic AI tool.

The product must make the user's own repository the centre of the experience.

The user should be able to move naturally from a project overview to a module, from a module to a file, from a file to a function, and from a function to a clear explanation.

The graphs must be useful. The citations must be real. The explanations must be grounded. The navigation must preserve context.

The design must follow KnowYourCode Brand Kit v1.0. Do not improvise a new visual identity.

The seven product modules must remain part of the complete product definition. However, Experiment is explicitly deferred from the MVP and must not be presented as a partially implemented feature.

The most important measure of success is not how much information the product displays.

It is whether a user can understand their own application better after using it.

**Know Your Code. Understand the code you ship.**
