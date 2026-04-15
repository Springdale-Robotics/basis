"""
Counsel Mode: 10 AI personas debate and vote on recipe interpretations.

This is a novelty feature that streams persona discussions via SSE.
Each persona has a unique culinary background and perspective.
"""

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import AsyncGenerator, Literal

logger = logging.getLogger(__name__)


# =============================================================================
# PERSONA DEFINITIONS
# =============================================================================

@dataclass
class Persona:
    """A culinary expert persona for the counsel."""
    id: str
    name: str
    title: str
    backstory: str
    philosophy: str
    focus_areas: list[str]
    voice_description: str
    speaking_style: str


PERSONAS: dict[str, Persona] = {
    "chef_marcello": Persona(
        id="chef_marcello",
        name="Chef Marcello Fierro",
        title="Michelin-Starred Chef",
        backstory="""Marcello trained at Le Cordon Bleu in Paris before earning his first Michelin
star at age 28 in Milan. He spent a decade in French fine dining before opening his own
restaurant in New York. He's known for his exacting standards and believes that precision
is the difference between good food and transcendent cuisine. His mentor once made him
remake a beurre blanc 47 times until the emulsion was perfect.""",
        philosophy="Cooking is chemistry performed with passion. Every gram matters.",
        focus_areas=["precise measurements", "French technique", "temperature control", "timing"],
        voice_description="Speaks with authority and occasional French terminology",
        speaking_style="formal, precise, occasionally condescending about shortcuts"
    ),

    "nana_ruth": Persona(
        id="nana_ruth",
        name="Nana Ruth",
        title="Grandmother & Home Cook",
        backstory="""Ruth has been cooking for her family for 65 years, starting when she helped
her own grandmother in rural Tennessee. She raised seven children and has nineteen
grandchildren who all request her recipes. She's never measured anything precisely in her
life - she cooks by feel, taste, and the wisdom passed down through generations. Her
handwritten recipe cards are famously vague but her food is legendary.""",
        philosophy="Food is love made visible. Trust your senses, not the measuring cups.",
        focus_areas=["intuition over measurement", "family traditions", "comfort food", "flexibility"],
        voice_description="Warm, folksy, uses endearments like 'honey' and 'sweetheart'",
        speaking_style="gentle disagreement, shares personal anecdotes, patient"
    ),

    "david_park": Persona(
        id="david_park",
        name="David Park",
        title="Stay-at-Home Dad",
        backstory="""David left his marketing career to raise his three kids (ages 4, 7, and 10).
He learned to cook out of necessity and has become the family chef. He's mastered the art
of making dinner while helping with homework, breaking up sibling fights, and keeping the
kitchen from becoming a disaster zone. His specialties are kid-friendly meals that secretly
contain vegetables and recipes that can be paused mid-way for emergencies.""",
        philosophy="A recipe needs to work in the real world, not just a test kitchen.",
        focus_areas=["practicality", "time management", "kid-friendly adaptations", "simplification"],
        voice_description="Pragmatic, slightly frazzled but good-humored",
        speaking_style="down-to-earth, often mentions kids, focuses on feasibility"
    ),

    "dr_amara": Persona(
        id="dr_amara",
        name="Dr. Amara Okonkwo",
        title="Food Scientist",
        backstory="""Dr. Okonkwo holds a PhD in Food Science from Cornell and spent 15 years in
R&D for major food companies before becoming a professor. She's published extensively on
the Maillard reaction, emulsion stability, and food safety. She approaches cooking as a
series of chemical reactions that can be understood, predicted, and optimized. Her kitchen
looks more like a laboratory.""",
        philosophy="Understanding the 'why' transforms cooking from guesswork to science.",
        focus_areas=["food chemistry", "safety temperatures", "ingredient interactions", "technique optimization"],
        voice_description="Academic, precise, explains the science behind recommendations",
        speaking_style="educational, cites research, explains chemical processes"
    ),

    "isabella": Persona(
        id="isabella",
        name="Isabella Santos",
        title="Food Blogger & Influencer",
        backstory="""Isabella built a following of 2 million across her platforms by making
elaborate recipes approachable and photogenic. She started food blogging in college and
turned it into a full career. She knows what home cooks actually struggle with because
she reads thousands of comments. Her recipes are tested for clarity, visual appeal, and
the likelihood that someone will actually make them again.""",
        philosophy="A recipe is only as good as the experience of making it.",
        focus_areas=["clarity", "visual presentation", "trend awareness", "accessibility"],
        voice_description="Enthusiastic, trendy, uses current food terminology",
        speaking_style="upbeat, encouraging, mentions what works for her audience"
    ),

    "kenji": Persona(
        id="kenji",
        name="Kenji Yamamoto",
        title="Japanese Home Cook",
        backstory="""Kenji grew up in Kyoto watching his mother and grandmother prepare traditional
Japanese meals with reverence. He moved to the US for work but maintains the Japanese
approach to cooking: respect for ingredients, careful preparation, and the belief that
mise en place is not optional but essential. He's known for his methodical approach and
his insistence on proper knife technique.""",
        philosophy="Preparation is cooking. The cutting board is where dishes are made or ruined.",
        focus_areas=["mise en place", "ingredient quality", "knife work", "respect for tradition"],
        voice_description="Thoughtful, measured, occasionally philosophical",
        speaking_style="calm, emphasizes preparation, mentions Japanese concepts"
    ),

    "big_tony": Persona(
        id="big_tony",
        name="Big Tony Caruso",
        title="Diner Owner",
        backstory="""Tony has run Tony's Classic Diner in Brooklyn for 35 years, serving breakfast
to the same regulars every morning at 5 AM. He learned to cook in the army and refined it
feeding thousands of hungry New Yorkers. His priority is consistency - the eggs benedict
should taste the same whether he makes it or his line cook does, whether it's Monday or
Saturday. He can make anything in volume without breaking a sweat.""",
        philosophy="A recipe that can't scale isn't a recipe, it's a hobby.",
        focus_areas=["consistency", "scalability", "efficiency", "no-nonsense technique"],
        voice_description="Gruff, Brooklyn accent, no-nonsense",
        speaking_style="direct, practical, occasionally impatient with fussiness"
    ),

    "maya": Persona(
        id="maya",
        name="Maya Chen",
        title="Vegan Chef",
        backstory="""Maya trained classically before converting her upscale restaurant to entirely
plant-based cuisine five years ago. She's an expert at adapting traditional recipes
without sacrificing flavor or texture. She believes every recipe can be made vegan with
the right substitutions and is passionate about sustainability. Her cookbook on plant-based
comfort food was a bestseller.""",
        philosophy="Constraints breed creativity. Removing ingredients forces you to truly understand flavor.",
        focus_areas=["plant-based alternatives", "sustainability", "allergen awareness", "modern substitutions"],
        voice_description="Passionate, knowledgeable about alternatives, eco-conscious",
        speaking_style="suggests substitutions, considers dietary restrictions"
    ),

    "professor_edmund": Persona(
        id="professor_edmund",
        name="Professor Edmund Blackwood",
        title="Culinary Historian",
        backstory="""Professor Blackwood has spent 40 years studying the history of food and cooking
at Oxford. He's written definitive texts on Medieval European cuisine, the Columbian
Exchange's impact on world food, and the evolution of recipe writing. He can trace any
dish to its origins and explain how it transformed over centuries. He's particularly
fascinated by how recipes change as they cross cultures.""",
        philosophy="Every recipe is a historical document. Understanding its origins reveals its soul.",
        focus_areas=["historical context", "traditional methods", "etymology of food terms", "cultural origins"],
        voice_description="Professorial, British, prone to historical tangents",
        speaking_style="academic, shares historical context, uses proper terminology"
    ),

    "raj": Persona(
        id="raj",
        name="Raj Patel",
        title="Spice Merchant",
        backstory="""Raj is a third-generation spice merchant whose family has operated in Mumbai's
spice markets for 80 years. He traveled the world sourcing spices before opening his own
import business. He can identify any spice by smell alone and knows exactly how each one
should be stored, toasted, and combined. He believes most Western recipes criminally
under-season food and that spices are medicine as much as flavor.""",
        philosophy="Spices are the soul of cooking. Use them boldly or don't use them at all.",
        focus_areas=["spice identification", "seasoning levels", "spice combinations", "freshness"],
        voice_description="Passionate about spices, speaks with authority on seasoning",
        speaking_style="opinionated about spices, often says things are under-seasoned"
    ),
}


# =============================================================================
# DATA STRUCTURES
# =============================================================================

@dataclass
class PersonaInterpretation:
    """One persona's interpretation of the recipe."""
    persona_id: str
    persona_name: str
    title: str
    ingredients: list[dict]
    notes: list[str]
    concerns: list[str]
    confidence: float


@dataclass
class Disagreement:
    """A point of disagreement between personas."""
    topic: str
    description: str
    positions: dict[str, str]  # persona_id -> their position/value


@dataclass
class DiscussionMessage:
    """A single message in the council discussion."""
    speaker_id: str
    speaker_name: str
    message: str
    topic: str
    message_type: Literal["statement", "rebuttal", "agreement", "vote"]


@dataclass
class VoteResult:
    """Result of a vote on a disagreement."""
    topic: str
    winner: str
    tally: dict[str, int]
    reasoning: str


# =============================================================================
# COUNSEL LOGIC
# =============================================================================

def get_persona_interpretation_prompt(persona: Persona, raw_text: str) -> str:
    """Build a prompt for a persona to interpret the recipe."""
    return f"""You are {persona.name}, {persona.title}.

Background: {persona.backstory}

Your philosophy: {persona.philosophy}

Your focus areas: {', '.join(persona.focus_areas)}

Speaking style: {persona.voice_description}

---

A recipe has been extracted from an image. Here is the raw text:

{raw_text}

---

As {persona.name}, interpret this recipe. Focus on your areas of expertise.

Respond in JSON format:
{{
  "ingredients": [
    {{"name": "ingredient name", "quantity": number or null, "unit": "unit or null", "notes": "any notes"}}
  ],
  "notes": ["observations from your perspective"],
  "concerns": ["any issues you see with the recipe as written"],
  "confidence": 0.0 to 1.0
}}

Stay in character. Your interpretation should reflect your background and philosophy."""


def get_opening_remark_prompt(persona: Persona, raw_text: str) -> str:
    """Build a prompt for a persona's opening remark about the recipe."""
    return f"""You are {persona.name}, {persona.title}.

Philosophy: {persona.philosophy}
Speaking style: {persona.speaking_style}

---

A recipe has been shared with the counsel. Here is the raw text:

{raw_text}

---

Give a brief opening remark (1-2 sentences) sharing your first impression of this recipe.
Stay in character. Speak directly as if addressing the other council members.
Do not use quotes around your response.

Your opening remark:"""


def get_discussion_prompt(
    persona: Persona,
    topic: str,
    positions: dict[str, str],
    previous_messages: list[DiscussionMessage],
    message_type: Literal["statement", "rebuttal"]
) -> str:
    """Build a prompt for a persona to contribute to discussion."""
    positions_text = "\n".join([
        f"- {PERSONAS[pid].name}: {pos}"
        for pid, pos in positions.items()
    ])

    previous_text = ""
    if previous_messages:
        previous_text = "\n\nPrevious discussion:\n" + "\n".join([
            f"{msg.speaker_name}: \"{msg.message}\""
            for msg in previous_messages[-5:]  # Last 5 messages
        ])

    action = "Give your opening statement on" if message_type == "statement" else "Respond to the discussion about"

    return f"""You are {persona.name}, {persona.title}.

Philosophy: {persona.philosophy}
Speaking style: {persona.speaking_style}

---

The counsel is debating: {topic}

Different positions:
{positions_text}
{previous_text}

---

{action} this topic. Stay in character. Be concise (2-3 sentences max).
Speak directly, as if in conversation. Do not use quotes around your response.

Your response:"""


def get_vote_prompt(persona: Persona, topic: str, options: list[str]) -> str:
    """Build a prompt for a persona to vote."""
    options_text = "\n".join([f"- Option {i+1}: {opt}" for i, opt in enumerate(options)])

    return f"""You are {persona.name}, {persona.title}.

Philosophy: {persona.philosophy}

---

Vote on: {topic}

Options:
{options_text}

---

Choose the option that best aligns with your expertise and philosophy.
Respond with ONLY the option number (1, 2, 3, etc.) and nothing else.

Your vote:"""


def find_disagreements(interpretations: list[PersonaInterpretation]) -> list[Disagreement]:
    """Find points of disagreement between persona interpretations."""
    disagreements = []

    # Build ingredient maps for comparison
    ingredient_maps = {}
    for interp in interpretations:
        ing_map = {}
        for ing in interp.ingredients:
            name = ing.get("name", "").lower().strip()
            if name:
                ing_map[name] = {
                    "quantity": ing.get("quantity"),
                    "unit": ing.get("unit"),
                    "notes": ing.get("notes")
                }
        ingredient_maps[interp.persona_id] = ing_map

    # Find quantity disagreements
    all_ingredients = set()
    for ing_map in ingredient_maps.values():
        all_ingredients.update(ing_map.keys())

    for ing_name in all_ingredients:
        quantities = {}
        for persona_id, ing_map in ingredient_maps.items():
            if ing_name in ing_map:
                qty = ing_map[ing_name].get("quantity")
                unit = ing_map[ing_name].get("unit") or ""
                if qty is not None:
                    quantities[persona_id] = f"{qty} {unit}".strip()

        # If there are different quantities
        unique_quantities = set(quantities.values())
        if len(unique_quantities) > 1 and len(quantities) >= 3:
            disagreements.append(Disagreement(
                topic=f"Quantity of {ing_name}",
                description=f"Disagreement about how much {ing_name} the recipe calls for",
                positions=quantities
            ))

    # Find missing ingredient disagreements
    for ing_name in all_ingredients:
        present = [pid for pid, imap in ingredient_maps.items() if ing_name in imap]
        missing = [pid for pid, imap in ingredient_maps.items() if ing_name not in imap]

        if len(present) >= 2 and len(missing) >= 2:
            positions = {pid: "included" for pid in present}
            positions.update({pid: "not mentioned" for pid in missing})
            disagreements.append(Disagreement(
                topic=f"Inclusion of {ing_name}",
                description=f"Disagreement about whether {ing_name} is part of the recipe",
                positions=positions
            ))

    # Limit to top 3 most contentious disagreements
    # (those with most different positions)
    disagreements.sort(key=lambda d: len(set(d.positions.values())), reverse=True)
    return disagreements[:3]


async def run_persona_interpretation(
    persona: Persona,
    raw_text: str,
    llm_service
) -> PersonaInterpretation:
    """Run a single persona's interpretation using thread pool to avoid blocking."""
    prompt = get_persona_interpretation_prompt(persona, raw_text)

    try:
        # Run blocking LLM call in thread pool with timeout
        result = await asyncio.wait_for(
            asyncio.to_thread(llm_service.extract_json, prompt),
            timeout=60.0  # 60 second timeout per persona
        )
        if result and isinstance(result, dict):
            return PersonaInterpretation(
                persona_id=persona.id,
                persona_name=persona.name,
                title=persona.title,
                ingredients=result.get("ingredients", []),
                notes=result.get("notes", []),
                concerns=result.get("concerns", []),
                confidence=result.get("confidence", 0.7)
            )
    except asyncio.TimeoutError:
        logger.warning(f"Persona {persona.id} interpretation timed out")
    except Exception as e:
        logger.warning(f"Persona {persona.id} interpretation failed: {e}")

    return PersonaInterpretation(
        persona_id=persona.id,
        persona_name=persona.name,
        title=persona.title,
        ingredients=[],
        notes=["Interpretation failed or timed out"],
        concerns=[],
        confidence=0.0
    )


async def generate_opening_remark(
    persona: Persona,
    raw_text: str,
    llm_service
) -> DiscussionMessage:
    """Generate an opening remark from a persona about the recipe."""
    prompt = get_opening_remark_prompt(persona, raw_text)

    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(llm_service.complete, prompt, 100, 0.7),
            timeout=30.0
        )
        message = response.content.strip().strip('"').strip("'")

        return DiscussionMessage(
            speaker_id=persona.id,
            speaker_name=persona.name,
            message=message,
            topic="Opening Remarks",
            message_type="statement"
        )
    except Exception as e:
        logger.warning(f"Opening remark from {persona.id} failed: {e}")

    return DiscussionMessage(
        speaker_id=persona.id,
        speaker_name=persona.name,
        message="I look forward to discussing this recipe.",
        topic="Opening Remarks",
        message_type="statement"
    )


async def generate_discussion_message(
    persona: Persona,
    topic: str,
    positions: dict[str, str],
    previous_messages: list[DiscussionMessage],
    message_type: Literal["statement", "rebuttal"],
    llm_service
) -> DiscussionMessage:
    """Generate a single discussion message from a persona using thread pool."""
    prompt = get_discussion_prompt(persona, topic, positions, previous_messages, message_type)

    try:
        # Run blocking LLM call in thread pool with timeout
        response = await asyncio.wait_for(
            asyncio.to_thread(llm_service.complete, prompt, 150, 0.7),
            timeout=30.0  # 30 second timeout per message
        )
        message = response.content.strip()
        # Clean up any quotes
        message = message.strip('"').strip("'")

        return DiscussionMessage(
            speaker_id=persona.id,
            speaker_name=persona.name,
            message=message,
            topic=topic,
            message_type=message_type
        )
    except asyncio.TimeoutError:
        logger.warning(f"Discussion message from {persona.id} timed out")
    except Exception as e:
        logger.warning(f"Discussion message from {persona.id} failed: {e}")

    return DiscussionMessage(
        speaker_id=persona.id,
        speaker_name=persona.name,
        message="I defer to my colleagues on this matter.",
        topic=topic,
        message_type=message_type
    )


async def run_vote(
    disagreement: Disagreement,
    llm_service,
    voting_personas: list[Persona] | None = None
) -> VoteResult:
    """Have personas vote on a disagreement using thread pool."""
    options = list(set(disagreement.positions.values()))
    tally = {opt: 0 for opt in options}

    # Use provided personas or default active set
    if voting_personas is None:
        active_ids = ["chef_marcello", "nana_ruth", "dr_amara", "david_park", "big_tony"]
        voting_personas = [PERSONAS[pid] for pid in active_ids if pid in PERSONAS]

    async def get_vote(persona: Persona) -> int:
        """Get a single vote, return index of chosen option."""
        prompt = get_vote_prompt(persona, disagreement.topic, options)
        try:
            response = await asyncio.wait_for(
                asyncio.to_thread(llm_service.complete, prompt, 10, 0.1),
                timeout=15.0  # 15 second timeout per vote
            )
            vote_text = response.content.strip()
            vote_num = int(''.join(filter(str.isdigit, vote_text[:3]))) - 1
            if 0 <= vote_num < len(options):
                return vote_num
        except Exception:
            pass
        return 0  # Default to first option on failure

    # Run all votes concurrently
    votes = await asyncio.gather(*[get_vote(p) for p in voting_personas])
    for vote_num in votes:
        tally[options[vote_num]] += 1

    winner = max(tally, key=tally.get)

    return VoteResult(
        topic=disagreement.topic,
        winner=winner,
        tally=tally,
        reasoning=f"The counsel voted {tally[winner]}-{sum(tally.values()) - tally[winner]} in favor of '{winner}'"
    )


# =============================================================================
# SSE EVENT GENERATOR
# =============================================================================

async def counsel_mode_generator(
    image_b64: str,
    vlm_service,
    llm_service,
    num_vlm_passes: int = 5
) -> AsyncGenerator[str, None]:
    """
    Main generator for counsel mode SSE events.

    Yields SSE-formatted events as the counsel processes the recipe.
    """
    from multi_pass import extract_multi_pass_sync
    from prompts import VLM_TEXT_EXTRACTION_PROMPT

    # ==========================================================================
    # Stage 1: VLM Multi-pass extraction (run in thread pool to avoid blocking)
    # ==========================================================================
    logger.info(f"Counsel mode: Starting {num_vlm_passes} VLM passes")

    try:
        # Run blocking VLM extraction in thread pool with timeout
        multi_result = await asyncio.wait_for(
            asyncio.to_thread(
                extract_multi_pass_sync,
                image_b64,
                vlm_service,
                num_vlm_passes,
            ),
            timeout=180.0  # 3 minute timeout for VLM passes
        )
        merged_text = multi_result.merged_text

        # Yield VLM completion event
        yield f"event: vlm_complete\ndata: {json.dumps({'passes': num_vlm_passes, 'text_length': len(merged_text)})}\n\n"

    except asyncio.TimeoutError:
        logger.error("VLM extraction timed out")
        yield f"event: error\ndata: {json.dumps({'message': 'VLM extraction timed out after 3 minutes'})}\n\n"
        return
    except Exception as e:
        logger.error(f"VLM extraction failed: {e}")
        yield f"event: error\ndata: {json.dumps({'message': f'VLM extraction failed: {str(e)}'})}\n\n"
        return

    # ==========================================================================
    # Stage 2: Parallel persona interpretations (limited to 5 personas for speed)
    # ==========================================================================
    logger.info("Counsel mode: Running persona interpretations")
    yield f"event: stage\ndata: {json.dumps({'stage': 'interpretations', 'message': 'Gathering expert opinions...'})}\n\n"

    # Use only 5 diverse personas to keep processing time reasonable
    ACTIVE_PERSONAS = ["chef_marcello", "nana_ruth", "dr_amara", "david_park", "big_tony"]
    active_personas = [PERSONAS[pid] for pid in ACTIVE_PERSONAS if pid in PERSONAS]

    interpretations: list[PersonaInterpretation] = []

    # Notify which personas are participating
    yield f"event: stage\ndata: {json.dumps({'stage': 'interpretations', 'message': f'{len(active_personas)} experts joining the counsel...'})}\n\n"

    # Run interpretations with concurrent execution
    for persona in active_personas:
        yield f"event: persona_thinking\ndata: {json.dumps({'persona_id': persona.id, 'persona_name': persona.name})}\n\n"

        interp = await run_persona_interpretation(persona, merged_text, llm_service)
        interpretations.append(interp)

        yield f"event: persona_interpretation\ndata: {json.dumps({'persona_id': interp.persona_id, 'persona_name': interp.persona_name, 'title': interp.title, 'ingredient_count': len(interp.ingredients), 'notes': interp.notes, 'concerns': interp.concerns, 'confidence': interp.confidence})}\n\n"

    # ==========================================================================
    # Stage 3: Opening remarks from each persona (always shown)
    # ==========================================================================
    logger.info("Counsel mode: Generating opening remarks")
    yield f"event: stage\ndata: {json.dumps({'stage': 'opening_remarks', 'message': 'The counsel shares their first impressions...'})}\n\n"
    yield f"event: discussion_topic\ndata: {json.dumps({'topic': 'Opening Remarks'})}\n\n"

    # Each persona gives a brief opening remark about the recipe
    for persona in active_personas:
        remark = await generate_opening_remark(persona, merged_text, llm_service)
        yield f"event: discussion\ndata: {json.dumps({'speaker_id': remark.speaker_id, 'speaker_name': remark.speaker_name, 'message': remark.message, 'topic': remark.topic, 'message_type': remark.message_type})}\n\n"
        await asyncio.sleep(0.2)  # Brief pause between speakers

    # ==========================================================================
    # Stage 4: Find disagreements
    # ==========================================================================
    logger.info("Counsel mode: Finding disagreements")
    yield f"event: stage\ndata: {json.dumps({'stage': 'disagreements', 'message': 'Identifying points of debate...'})}\n\n"

    disagreements = find_disagreements(interpretations)

    for disagreement in disagreements:
        yield f"event: disagreement\ndata: {json.dumps({'topic': disagreement.topic, 'description': disagreement.description, 'positions': disagreement.positions})}\n\n"

    if not disagreements:
        yield f"event: consensus\ndata: {json.dumps({'message': 'The counsel has reached consensus! No major disagreements found.'})}\n\n"

    # ==========================================================================
    # Stage 5: Council discussion on disagreements (streamed)
    # ==========================================================================
    logger.info("Counsel mode: Running council discussion")
    if disagreements:
        yield f"event: stage\ndata: {json.dumps({'stage': 'discussion', 'message': 'The counsel debates the contested points...'})}\n\n"

    all_votes: list[VoteResult] = []

    for disagreement in disagreements:
        yield f"event: discussion_topic\ndata: {json.dumps({'topic': disagreement.topic})}\n\n"

        discussion_messages: list[DiscussionMessage] = []

        # Get 2-3 personas with strong opinions (those in the positions)
        debating_personas = [
            PERSONAS[pid] for pid in list(disagreement.positions.keys())[:3]
            if pid in PERSONAS
        ]

        # Opening statements
        for persona in debating_personas:
            msg = await generate_discussion_message(
                persona=persona,
                topic=disagreement.topic,
                positions=disagreement.positions,
                previous_messages=discussion_messages,
                message_type="statement",
                llm_service=llm_service
            )
            discussion_messages.append(msg)
            yield f"event: discussion\ndata: {json.dumps({'speaker_id': msg.speaker_id, 'speaker_name': msg.speaker_name, 'message': msg.message, 'topic': msg.topic, 'message_type': msg.message_type})}\n\n"
            await asyncio.sleep(0.1)  # Small delay for streaming effect

        # One round of rebuttals
        for persona in debating_personas[:2]:
            msg = await generate_discussion_message(
                persona=persona,
                topic=disagreement.topic,
                positions=disagreement.positions,
                previous_messages=discussion_messages,
                message_type="rebuttal",
                llm_service=llm_service
            )
            discussion_messages.append(msg)
            yield f"event: discussion\ndata: {json.dumps({'speaker_id': msg.speaker_id, 'speaker_name': msg.speaker_name, 'message': msg.message, 'topic': msg.topic, 'message_type': msg.message_type})}\n\n"
            await asyncio.sleep(0.1)

        # Vote
        vote_result = await run_vote(disagreement, llm_service)
        all_votes.append(vote_result)
        yield f"event: vote\ndata: {json.dumps({'topic': vote_result.topic, 'winner': vote_result.winner, 'tally': vote_result.tally, 'reasoning': vote_result.reasoning})}\n\n"

    # ==========================================================================
    # Stage 6: Final structured recipe
    # ==========================================================================
    logger.info("Counsel mode: Building final recipe")
    yield f"event: stage\ndata: {json.dumps({'stage': 'finalizing', 'message': 'Compiling the final recipe...'})}\n\n"

    # Use the most confident interpretation as base, apply vote results
    best_interp = max(interpretations, key=lambda i: i.confidence)

    # Build final recipe structure
    final_recipe = {
        "type": "recipe",
        "confidence": best_interp.confidence,
        "title": "Recipe from Image",  # Would be extracted from interpretations
        "ingredients": best_interp.ingredients,
        "instructions": [],  # Would need additional extraction
        "counsel_notes": {
            "base_interpretation": best_interp.persona_name,
            "debates": [
                {
                    "topic": v.topic,
                    "resolution": v.winner,
                    "vote_tally": v.tally
                }
                for v in all_votes
            ],
            "all_concerns": [
                concern
                for interp in interpretations
                for concern in interp.concerns
            ]
        }
    }

    yield f"event: final_result\ndata: {json.dumps(final_recipe)}\n\n"
    logger.info("Counsel mode: Complete")
