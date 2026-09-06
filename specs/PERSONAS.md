# Finance Finder User Personas

> These personas drive testing and UX decisions. Reference by name in specs and tests.

## Primary Personas

### [Persona Name, e.g., "Maria"]

**Profile**:
- **Role**: [e.g., MEI selling clothes via WhatsApp]
- **Age range**: [e.g., 25-45]
- **Tech comfort**: [Low | Medium | High]
- **Language**: [e.g., Portuguese (BR), informal]
- **Context**: [e.g., Uses phone while managing store]

**Goals**:
1. [Primary goal, e.g., "Track daily sales quickly"]
2. [Secondary goal, e.g., "Respond to customers faster"]
3. [Tertiary goal, e.g., "Spend less time on admin"]

**Pain Points**:
- [Current frustration 1, e.g., "Loses track of orders in chat history"]
- [Current frustration 2, e.g., "Manual calculations take time"]
- [Current frustration 3, e.g., "Forgets to follow up with customers"]

**Typical Day**:
> [2-3 sentence narrative of how they work]
> "Maria opens her store at 8am. Throughout the day, she responds to WhatsApp messages while serving in-person customers. She often forgets which orders are pending and loses track of what sold."

**Key Scenarios**:

#### Scenario 1: [Name, e.g., "Check daily sales"]
```
Context: End of day, wants quick summary
Action: Sends "vendas de hoje"
Expectation: See total R$, number of items, compared to yesterday
Success: Gets answer in < 5 seconds, no app switching needed
```

#### Scenario 2: [Name, e.g., "Record a sale"]
```
Context: Just sold an item, customer in front of her
Action: Quick voice or text message
Expectation: Sale recorded without complex data entry
Success: Confirmation in < 3 seconds, can continue serving customer
```

#### Scenario 3: [Name, e.g., "Handle objection"]
```
Context: Customer says product is too expensive
Action: Asks for help responding
Expectation: Gets suggested response she can customize
Success: Response feels natural, not robotic
```

---

### [Second Persona Name, e.g., "João"]

[Same structure as above]

---

## Anti-Personas

People we are **NOT** designing for (to maintain focus):

### [Anti-Persona Name]
- **Why not**: [e.g., "Large businesses with ERP systems - not our target"]
- **Implication**: [e.g., "Don't build complex inventory management"]

---

## Persona Usage Guide

When implementing features, ask:
1. Which persona does this serve?
2. How would [Persona Name] discover this feature?
3. Does the language match their tech comfort?
4. Does it fit their typical day flow?

When testing:
1. Walk through each relevant persona's scenarios
2. Use their language patterns in test inputs
3. Verify response tone matches their expectations
