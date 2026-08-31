# ULTM8 Design Guidelines

## Purpose

This document provides the design and UI/UX implementation guidelines for ULTM8. It complements `CLAUDE.md`, the technical specification, and the canonical domain rules (`skills/ultm8-domain-rules/SKILL.md`) — it does not replace or override any of them. Where this document is silent or in conflict, those sources govern.

## Design Direction

ULTM8's intended design direction is:

- premium
- minimal
- modern
- technology-forward
- confident
- visually immersive
- highly polished
- simple and intuitive
- conversion-focused where appropriate

This direction is inspired by the clarity, restraint, hierarchy, simplicity, and polished product experience associated with brands such as Apple and Tesla.

ULTM8 must **not** copy Apple's or Tesla's proprietary visual identity, layouts, branding, assets, or interfaces. The goal is to learn from high-level design principles while creating an original ULTM8 identity.

The ULTM8 design should combine:

- **Apple-inspired**: clarity, simplicity, whitespace, typography hierarchy, consistency, and attention to detail.
- **Tesla-inspired**: bold visual hierarchy, immersive imagery, focused user journeys, strong calls to action, and reduced interface friction.
- **A distinctive ULTM8 martial-arts identity**, expressed through appropriate imagery, motion, energy, progression, training, and performance-oriented visual language.

## Design Source of Truth

When design intent is unclear or sources disagree, resolve in this order, highest first:

1. Approved technical/product requirements in the current Spec 55.
2. Explicitly approved product and UX decisions.
3. Approved Figma/design-system decisions.
4. Existing implemented UI, where intentionally retained.
5. Design observations that have not yet been formally approved.

Figma is a design reference and must not be treated as an authoritative source for undefined business logic.

## Design Principles

- Simplicity over unnecessary complexity.
- Strong visual hierarchy.
- Generous and intentional whitespace.
- Clear typography hierarchy.
- Premium visual polish.
- Consistent components and interactions.
- Intuitive navigation.
- Minimal user friction.
- Clear calls to action.
- Purposeful animation and motion.
- Accessibility.
- Responsive behaviour.
- Maintainability.
- Reusable components.

Every visual element should have a purpose; unnecessary decoration should be avoided.

## Visual Identity

ULTM8 should develop its own visual identity rather than reproducing Apple or Tesla.

The visual system should eventually define, based on approved design work:

- colour palette
- typography
- spacing
- border radius
- shadows
- iconography
- imagery
- buttons
- forms
- cards
- navigation
- dashboards
- data visualisation
- motion and transitions

Actual values for these items are not defined in this initial document.

## Figma Interpretation Rules

- Figma should be inspected before implementing a UI that has an approved design.
- Intentional visual details should be preserved where compatible with the specification.
- A Figma-only behaviour must not automatically become a business rule.
- If Figma conflicts with Spec 55, the specification takes precedence and the conflict must be flagged.
- If a design is ambiguous, mark it as `[UNRESOLVED]` rather than guessing.

## Responsive Design

General expectations apply for:

- mobile
- tablet
- desktop
- responsive layouts
- touch interactions
- readable content
- avoiding horizontal overflow

Exact breakpoints are not defined here and should not be invented until formally approved.

## Accessibility

General expectations apply for:

- keyboard accessibility
- semantic HTML
- appropriate labels
- visible focus states
- sufficient contrast
- accessible forms
- meaningful error and success feedback
- screen-reader compatibility where applicable

## Components and UI Patterns

- Reusable components are preferred over duplicated UI.
- Components should have predictable states.
- Loading, empty, error, success, disabled, and validation states should be considered where applicable.
- Components should maintain visual consistency across the platform.
- Component behaviour must follow the technical specification and approved UX decisions.
- Developers must not invent product behaviour merely to complete a visual design.

## Design vs Business Logic

Design defines how something should look and behave visually.

The technical specification and canonical domain rules define what the product is allowed or required to do.

When a design implies business logic that is not confirmed by the specification, it must be treated as `[UNRESOLVED]` and escalated rather than implemented by assumption.

## Motion and Interaction

Motion should be:

- purposeful
- subtle where appropriate
- responsive
- consistent
- used to communicate state, hierarchy, or transitions
- never used at the expense of usability or performance

The goal is a premium, polished experience rather than excessive animation.

## Change and Review Rules

- Approved design changes should be reflected consistently.
- Significant design changes should be reviewed against Spec 55 and domain rules.
- Design decisions should not silently contradict established product requirements.
- Unresolved design questions should be documented before implementation.
- This document is a living guideline and should evolve as the ULTM8 design system is formally approved.

## Current Status

This is an initial design-governance document created during development preparation.

Detailed design-system values, component specifications, screen-level rules, and the final ULTM8 visual identity will be refined from the approved Figma/design materials before or during implementation.
