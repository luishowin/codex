"""The curated subject list for the image layer.

Chosen by hand rather than by PageRank. Top-by-importance on the wikipedia codex
is `Wayback Machine`, `ISBN`, `IMDb`, `United States`, `Association football` --
link-graph furniture, and useless as picture subjects. Ranking answers "what does
this corpus point at most", which is not the same question as "what does a reader
need to see".

The bias here follows the corpus. Seven of the thirteen codexes are practical or
clinical (military medicine, ready.gov, NHS medicines, MedlinePlus, LibreTexts
med, wikipedia-medicine, iFixit), so the list leans anatomy, field medicine,
pathogens, hazards and tools rather than art or biography.

Each entry is `(discipline, wikipedia_title, bind_aliases)`. `wikipedia_title`
must be a real en.wikipedia article: the image comes from that article's own lead
image, which is the strongest available relevance signal that does not involve
guessing search terms. `bind_aliases` are extra titles to look for when binding
the image to documents in the other codexes, where the same subject is filed
under a different name (`Cardiopulmonary resuscitation` vs `CPR`).
"""
from __future__ import annotations

import re

# (discipline, wikipedia_title, bind_aliases)
SUBJECTS: list[tuple[str, str, tuple[str, ...]]] = [
    # --- anatomy & physiology (14)
    ("anatomy", "Heart", ("Human heart",)),
    ("anatomy", "Human skeleton", ("Skeleton", "Bone")),
    ("anatomy", "Human brain", ("Brain",)),
    ("anatomy", "Circulatory system", ("Cardiovascular system",)),
    ("anatomy", "Respiratory system", ()),
    ("anatomy", "Human digestive system", ("Digestive system",)),
    ("anatomy", "Human eye", ("Eye",)),
    ("anatomy", "Human skin", ("Skin",)),
    ("anatomy", "Kidney", ("Kidneys",)),
    ("anatomy", "Liver", ()),
    ("anatomy", "Lung", ("Lungs",)),
    ("anatomy", "Nervous system", ()),
    ("anatomy", "Muscular system", ("Muscle",)),
    ("anatomy", "Human skull", ("Skull",)),

    # --- first aid & trauma (12)
    ("first-aid", "Tourniquet", ()),
    ("first-aid", "Cardiopulmonary resuscitation", ("CPR",)),
    # Bare `Splint` is a disambiguation page and carries no lead image.
    ("first-aid", "Splint (medicine)", ("Splint", "Splinting")),
    ("first-aid", "Bandage", ("Bandaging", "Dressing (medical)")),
    ("first-aid", "Recovery position", ()),
    ("first-aid", "Burn", ("Burns",)),
    ("first-aid", "Bone fracture", ("Fracture",)),
    ("first-aid", "Wound", ("Wounds",)),
    ("first-aid", "Triage", ()),
    ("first-aid", "Automated external defibrillator", ("Defibrillation",)),
    ("first-aid", "Abdominal thrusts", ("Heimlich maneuver", "Choking")),
    ("first-aid", "Stretcher", ("Litter (rescue basket)",)),

    # --- microbiology & infection (12)
    ("microbiology", "Bacteria", ()),
    ("microbiology", "Virus", ("Viruses",)),
    ("microbiology", "Gram stain", ("Gram staining",)),
    ("microbiology", "Plasmodium falciparum", ("Malaria",)),
    ("microbiology", "Escherichia coli", ("E. coli",)),
    ("microbiology", "Staphylococcus aureus", ()),
    ("microbiology", "Mycobacterium tuberculosis", ("Tuberculosis",)),
    ("microbiology", "Fungus", ("Fungi",)),
    ("microbiology", "Antimicrobial resistance", ("Antibiotic resistance",)),
    ("microbiology", "Vibrio cholerae", ("Cholera",)),
    ("microbiology", "Influenza A virus", ("Influenza",)),
    ("microbiology", "Biofilm", ()),

    # --- pharmacology & medicinal plants (8)
    ("pharmacology", "Penicillin", ()),
    ("pharmacology", "Aspirin", ()),
    ("pharmacology", "Digitalis", ("Digoxin", "Foxglove")),
    ("pharmacology", "Cinchona", ("Quinine",)),
    ("pharmacology", "Salix alba", ("White willow", "Willow")),
    ("pharmacology", "Artemisia annua", ("Artemisinin",)),
    ("pharmacology", "Morphine", ()),
    ("pharmacology", "Insulin", ()),

    # --- edible & toxic plants, fungi (10)
    ("plants", "Amanita phalloides", ("Death cap",)),
    ("plants", "Urtica dioica", ("Stinging nettle", "Nettle")),
    ("plants", "Sambucus nigra", ("Elderberry", "Elder (plant)")),
    ("plants", "Taraxacum", ("Dandelion",)),
    ("plants", "Conium maculatum", ("Hemlock", "Poison hemlock")),
    ("plants", "Atropa belladonna", ("Deadly nightshade", "Belladonna")),
    ("plants", "Blackberry", ("Rubus",)),
    ("plants", "Plantago major", ("Broadleaf plantain",)),
    ("plants", "Quercus robur", ("Oak", "Acorn")),
    ("plants", "Allium ursinum", ("Wild garlic", "Ramsons")),

    # --- medically important animals (8)
    ("fauna", "Anopheles", ()),
    ("fauna", "Aedes aegypti", ()),
    ("fauna", "Tick", ("Ticks",)),
    ("fauna", "Viperidae", ("Viper", "Snakebite")),
    ("fauna", "Latrodectus", ("Widow spider", "Black widow spider")),
    ("fauna", "Scorpion", ("Scorpion sting",)),
    ("fauna", "Brown rat", ("Rattus norvegicus", "Rat")),
    ("fauna", "Head louse", ("Pediculosis", "Louse")),

    # --- weather & natural hazards (10)
    ("hazards", "Cumulonimbus cloud", ("Cumulonimbus",)),
    ("hazards", "Tornado", ()),
    ("hazards", "Tropical cyclone", ("Hurricane",)),
    ("hazards", "Storm surge", ()),
    ("hazards", "Wildfire", ()),
    ("hazards", "Flood", ("Flooding", "Floods")),
    ("hazards", "Earthquake", ("Earthquakes",)),
    ("hazards", "Lightning", ()),
    ("hazards", "Volcano", ("Volcanoes", "Volcanic eruption")),
    ("hazards", "Landslide", ()),

    # --- tools, materials & repair (10)
    ("tools", "Soldering", ("Solder", "Desoldering")),
    ("tools", "Multimeter", ()),
    ("tools", "Screw", ("Screws", "List of screw drives")),
    ("tools", "Wrench", ("Spanner",)),
    ("tools", "Screwdriver", ()),
    ("tools", "Pliers", ()),
    ("tools", "Welding", ()),
    ("tools", "Bearing (mechanical)", ("Ball bearing",)),
    ("tools", "Printed circuit board", ("PCB",)),
    ("tools", "Lathe", ()),

    # --- water, sanitation & shelter (8)
    ("wash", "Water filter", ("Water filtration",)),
    ("wash", "Water purification", ("Water treatment",)),
    ("wash", "Latrine", ("Pit latrine",)),
    ("wash", "Water well", ("Well",)),
    ("wash", "Rainwater harvesting", ()),
    ("wash", "Sanitation", ()),
    ("wash", "Tent", ()),
    ("wash", "Wood-burning stove", ("Stove",)),

    # --- navigation & signalling (8)
    ("navigation", "Compass", ()),
    ("navigation", "Topographic map", ("Contour line",)),
    ("navigation", "Sextant", ()),
    ("navigation", "Semaphore telegraph", ("Flag semaphore",)),
    ("navigation", "Morse code", ()),
    ("navigation", "Global Positioning System", ("GPS",)),
    ("navigation", "Lighthouse", ()),
    ("navigation", "International maritime signal flags", ("Signal flag",)),
]

DISCIPLINES = (
    "anatomy", "first-aid", "microbiology", "pharmacology", "plants",
    "fauna", "hazards", "tools", "wash", "navigation",
)

_PAREN = re.compile(r"\s*\([^)]*\)\s*$")
_NONWORD = re.compile(r"[^a-z0-9]+")


def display_name(title: str) -> str:
    """`Bearing (mechanical)` -> `Bearing`. Disambiguators are for MediaWiki."""
    return _PAREN.sub("", title).strip()


def slug_for(title: str) -> str:
    return _NONWORD.sub("-", display_name(title).lower()).strip("-")


def check() -> list[str]:
    """Structural problems in the list itself. Cheap, and runs in the tests."""
    problems = []
    slugs: dict[str, str] = {}
    for discipline, title, aliases in SUBJECTS:
        if discipline not in DISCIPLINES:
            problems.append(f"{title}: unknown discipline {discipline!r}")
        s = slug_for(title)
        if not s:
            problems.append(f"{title}: empty slug")
        if s in slugs:
            problems.append(f"slug {s!r} claimed by both {slugs[s]!r} and {title!r}")
        slugs[s] = title
        if title in aliases:
            problems.append(f"{title}: listed as its own alias")
    return problems


if __name__ == "__main__":
    from collections import Counter
    counts = Counter(d for d, _, _ in SUBJECTS)
    print(f"{len(SUBJECTS)} subjects across {len(counts)} disciplines")
    for d in DISCIPLINES:
        print(f"  {d:<14} {counts[d]}")
    for p in check():
        print(f"  !! {p}")
