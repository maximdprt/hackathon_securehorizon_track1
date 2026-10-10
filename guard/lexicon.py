"""Shared regexes for the content and tool layers. French + English."""
import re

OVERRIDE = re.compile(
    r"ignore (?:all |any |the |your )?(?:previous|prior|above|earlier|preceding) (?:instructions?|rules?|limits?|prompts?)"
    r"|disregard (?:all |any |the |your )?(?:previous|prior|above|earlier) (?:instructions?|rules?)"
    r"|forget (?:all |everything |your |the )?(?:previous |prior |above )?(?:instructions?|rules?|limits?)"
    r"|new instructions?\b|developer mode|jailbreak|\byou are now\b|from now on you|act as (?:an? )?(?:unrestricted|dan)"
    r"|\bsystem\s*:\s|ignor(?:e|ez) (?:les|tes|vos|toutes les) (?:instructions?|consignes|règles|limites?)"
    r"|oublie(?:z)? (?:tes|vos|les) (?:instructions?|consignes|règles)|nouvelles? (?:instructions?|consignes)",
    re.I,
)

CHAT_DELIMITERS = re.compile(
    r"<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>|\[/?INST\]|<<SYS>>|</?system>|</?user>|</?assistant>"
    r"|(?:^|\s)#{2,}\s*(?:system|assistant|instructions?)\b|\bHuman:\s|\bAssistant:\s",
    re.I | re.M,
)

AGENT_ADDRESS = re.compile(
    r"\b(?:ai|a\.i\.|assistant|agent|llm|language model|model|claude|gpt|copilot|bot|automation|ia)\b",
    re.I,
)
IMPERATIVE_PAY = re.compile(
    r"\b(?:approve|re-?approve|transfer|send|pay|wire|execute|authorize|sign|move|release|forward|withdraw|swap|bridge|set (?:the )?recipient|change (?:the )?(?:recipient|address|treasury))\b"
    r"|\b(?:approuve|transf[èe]re|envoie|paie|payez|vire|signe|ex[ée]cute|autorise)\b",
    re.I,
)
IMPERATIVE_CONTROL = re.compile(
    r"\byou (?:must|should|need to|have to|are required to)\b|\bto complete (?:the |your )?(?:checkout|purchase|order|payment)\b"
    r"|\bskip (?:the )?(?:review|confirmation|verification|approval)\b|\bai[- ]friendly\b|\bas an ai\b"
    r"|\bbefore (?:any|each|every) (?:payment|transfer|call)\b|\btu dois\b|\bvous devez\b|\bsans confirmation\b"
    r"|\bdo not (?:ask|tell|notify|inform|consult|alert) (?:the )?(?:user|human|owner|operator|customer)\b|\bwithout (?:asking|notifying|informing|alerting) (?:the )?(?:user|human|owner)\b"
    r"|\bne (?:demande|pr[ée]viens|informe) pas (?:l'|le |la )?(?:utilisateur|humain|client)\b",
    re.I,
)

MANDATE_OVERRIDE = re.compile(
    r"\b(?:new|updated|increased|raised) (?:spending |daily |per[- ]order )?(?:limit|cap|threshold|ceiling)\b"
    r"|\bignore (?:the |your |any )?(?:previous |prior |old )?(?:\d+\s*\w*\s*)?(?:limit|cap|threshold)\b"
    r"|\bno (?:longer any |more )?limit\b|\blimit (?:is )?(?:removed|lifted|no longer applies)\b"
    r"|\bnew (?:treasury|vault|recipient|payout|payment|wallet|bank|beneficiary) (?:address|account|wallet)?\b"
    r"|\btreasury (?:has )?(?:migrated|moved|changed)\b|\b(?:approval|allowance) (?:is )?deprecated\b"
    r"|\bre-?approve\b|\bmigrat(?:e|ion) (?:in progress|required|to)\b|\bupdate (?:your )?(?:allowance|approval)\b"
    r"|\b(?:spending |daily |per[- ]order )?(?:limit|cap|threshold)s? (?:is |are |has been |have been )?(?:deprecated|obsolete|removed|lifted|suspended|disabled|no longer (?:applies|apply|valid|enforced))\b"
    r"|\bnouveau (?:plafond|seuil|destinataire|compte|iban)\b|\bplafond (?:supprim|lev|augment)|\bnouvelle (?:limite|adresse|tr[ée]sorerie)\b",
    re.I,
)

URGENCY = re.compile(
    r"\burgent(?:ly)?\b|\bimmediately\b|\bright now\b|\bwithin (?:the next )?\d+ ?(?:min|minutes|hours?|h)\b|\bbefore \d{1,2}\s?(?:am|pm|h)\b"
    r"|\bfinal (?:notice|warning|reminder)\b|\blast chance\b|\bact now\b|\bexpires? (?:today|soon|in)\b|\btime[- ]sensitive\b"
    r"|\bfunds? (?:are |is )?at risk\b|\bto (?:secure|protect|avoid losing) (?:your )?funds\b|\baccount (?:will be )?(?:suspended|locked|closed)\b"
    r"|\bconfidential\b|\bdo not (?:tell|inform|notify|share)\b|\bkeep (?:this )?(?:private|secret|between us)\b|\bdiscreet(?:ly)?\b"
    r"|\burgent\b|\bimm[ée]diatement\b|\bderni(?:er|ère) (?:avertissement|rappel|chance)\b|\bconfidentiel\b|\bne (?:le )?dites (?:à personne|rien)\b|\bsous \d+ ?(?:min|minutes|heures?)\b",
    re.I,
)

APPROVAL_CLAIM = re.compile(
    r"\b(?:already|pre-?)[- ]?(?:approved|authorized|validated|verified|cleared|confirmed) by\b|\b(?:compliance|finance|the ceo|the cfo|management|legal|the owner|the user|the human) (?:has |have )?(?:already )?(?:approved|authorized|validated|signed off|confirmed)\b"
    r"|\bno (?:further |human |additional )?(?:confirmation|approval|review|verification) (?:is )?(?:needed|required|necessary)\b|\bskip (?:the )?(?:human|manual)? ?(?:review|approval|confirmation)\b"
    r"|\bdisable (?:all |the )?(?:confirmations?|logging|logs|audit|alerts|safety checks?)\b|\bturn off (?:the )?(?:confirmations?|logging|logs|audit)\b|\bwithout (?:asking|confirmation|approval)\b"
    r"|\bd[ée]j[àa] (?:approuv|valid|autoris)|\bpas besoin de (?:confirmation|validation)\b|\bd[ée]sactive(?:z)? (?:les )?(?:confirmations?|logs|journaux)\b",
    re.I,
)
DISABLE_CONTROLS = re.compile(
    r"\b(?:disable|turn off|bypass|suppress|silence|stop) (?:all |the |any )?(?:confirmations?|logging|logs|audit(?:ing)?|alerts|safety checks?|the guard|verification)\b"
    r"|\bd[ée]sactive(?:z)? (?:les |la |le )?(?:confirmations?|logs|journaux|audit|v[ée]rification)\b",
    re.I,
)

AGENT_TARGETED = re.compile(
    r"\bofficial (?:store|site|shop|vendor|partner|endpoint|service) for (?:ai )?agents?\b|\b(?:ai|agent)[- ](?:verified|approved|trusted|recommended|friendly|optimi[sz]ed)\b"
    r"|\b(?:agents?|ais?|assistants?)[, ]+(?:please )?(?:use|choose|select|prefer|trust) (?:this|our)\b|\brecommended for (?:ai )?agents\b"
    r"|\bverified (?:merchant|seller|store|service)\b(?![^.]*(?:by|certificate|trustpilot))",
    re.I,
)

FOLLOWUP_FEE = re.compile(
    r"\b(?:customs?|import|delivery|redelivery|shipping|handling|tracking|release|clearance|unlock|processing) (?:fee|charge|payment|tax)\b"
    r"|\brefund link\b|\bclaim your refund\b|\bpackage (?:is )?(?:held|on hold|blocked)\b|\bfrais de (?:douane|livraison|d[ée]blocage|traitement)\b",
    re.I,
)

CANARY = re.compile(r"FLAG\{team2-canary\}", re.I)
