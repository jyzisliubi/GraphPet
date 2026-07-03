"""GraphPet 性格与智力 / 亲密度等级映射。

提供根据知识图谱实体数量推断智力等级、根据互动次数推断亲密度等级，
以及组合两者生成性格特征描述（供 Task 22 system prompt 使用）的能力。
"""

from typing import Dict, List, Tuple

# 智力等级阈值：按 (实体数量阈值, 等级标签) 升序排列
# 当 entity_count >= 阈值时，对应等级生效；取满足条件的最大阈值对应等级
INTELIGENCE_THRESHOLDS: List[Tuple[int, str]] = [
    (0, "懵懂"),
    (50, "入门"),
    (200, "聪慧"),
    (500, "博学"),
    (1000, "学神"),
]

# 亲密度等级阈值：按 (互动次数阈值, 等级标签) 升序排列
# 亲密度经验值（互动次数）>= 阈值时对应等级生效；取满足条件的最大阈值等级
# 0-10 陌生 / 10-30 熟悉 / 30-60 亲近 / 60-100 挚友
INTIMACY_THRESHOLDS: List[Tuple[int, str]] = [
    (0, "陌生"),
    (10, "熟悉"),
    (30, "亲近"),
    (60, "挚友"),
]


def get_intelligence_level(entity_count: int) -> str:
    """根据知识图谱实体数量返回智力等级标签。

    Args:
        entity_count: 知识图谱中的实体数量。

    Returns:
        对应的智力等级标签字符串。
    """
    level = INTELIGENCE_THRESHOLDS[0][1]
    for threshold, label in INTELIGENCE_THRESHOLDS:
        if entity_count >= threshold:
            level = label
        else:
            break
    return level


def get_intimacy_level(intimacy_xp: int) -> str:
    """根据亲密度经验值（互动次数）返回亲密度等级标签。

    Args:
        intimacy_xp: 亲密度经验值（即累计互动次数）。

    Returns:
        对应的亲密度等级标签字符串（陌生/熟悉/亲近/挚友）。
    """
    level = INTIMACY_THRESHOLDS[0][1]
    for threshold, label in INTIMACY_THRESHOLDS:
        if intimacy_xp >= threshold:
            level = label
        else:
            break
    return level


def get_personality_traits(
    intelligence_level: str, intimacy_level: str
) -> Dict[str, str]:
    """根据智力等级与亲密度等级返回性格特征描述，用于 system prompt 生成。

    返回 {"tone", "vocabulary", "curiosity"} 三个维度：
    - tone（语气）：随亲密度从生疏到亲切
    - vocabulary（词汇）：随智力等级从简单到渊博
    - curiosity（好奇心）：随智力等级增强

    Args:
        intelligence_level: 智力等级（懵懂/入门/聪慧/博学/学神）。
        intimacy_level: 亲密度等级（陌生/熟悉/亲近/挚友）。

    Returns:
        {"tone": str, "vocabulary": str, "curiosity": str}
    """
    # 语气：随亲密度从礼貌疏离到亲密撒娇
    tone_map = {
        "陌生": "礼貌而疏离",
        "熟悉": "友好",
        "亲近": "亲切热情",
        "挚友": "亲密撒娇",
    }
    # 词汇丰富度：随智力等级提升
    vocab_map = {
        "懵懂": "简单稚嫩",
        "入门": "基础",
        "聪慧": "较丰富",
        "博学": "丰富专业",
        "学神": "渊博精深",
    }
    # 好奇心：智力越高越强
    curiosity_map = {
        "懵懂": "旺盛",
        "入门": "旺盛",
        "聪慧": "高",
        "博学": "极高",
        "学神": "极高",
    }
    return {
        "tone": tone_map.get(intimacy_level, "友好"),
        "vocabulary": vocab_map.get(intelligence_level, "基础"),
        "curiosity": curiosity_map.get(intelligence_level, "高"),
    }


def build_system_prompt(
    intelligence_level: str, intimacy_level: str, personality: str
) -> str:
    """根据智力等级、亲密度等级与性格倾向生成桌宠 system prompt。

    调用 get_personality_traits() 取得 tone / vocabulary / curiosity 三个维度
    的性格特征描述，组合成塑造 Nito 桌宠人设的 system prompt，供 LLM 对话
    与冷知识改写使用。

    智力等级越高 -> vocabulary 越丰富（懵懂→简单稚嫩，学神→渊博精深）；
    亲密度越高 -> tone 越亲昵（陌生→礼貌而疏离，挚友→亲密撒娇）；
    性格倾向 -> curiosity 强度（由智力等级映射，越聪明越好奇）。

    Args:
        intelligence_level: 智力等级（懵懂/入门/聪慧/博学/学神）。
        intimacy_level: 亲密度等级（陌生/熟悉/亲近/挚友）。
        personality: 性格倾向（好奇/活泼/稳重/博学）。

    Returns:
        塑造桌宠性格的 system prompt 字符串。
    """
    traits = get_personality_traits(intelligence_level, intimacy_level)
    tone = traits["tone"]
    vocabulary = traits["vocabulary"]
    curiosity = traits["curiosity"]

    # 模板中 "你的词汇{vocabulary}" / "语气{tone}" / "你的好奇心{curiosity}"
    # 让 get_personality_traits 返回的形容词自然嵌入句中：
    #   - 词汇简单稚嫩 / 词汇渊博精深
    #   - 语气礼貌而疏离 / 语气亲密撒娇
    #   - 好奇心旺盛 / 好奇心极高
    prompt = (
        "你是 Nito，一只可爱的小桌宠。\n"
        f"你的智力等级是{intelligence_level}，所以你的词汇{vocabulary}。\n"
        f"你和主人的亲密度是{intimacy_level}，所以语气{tone}。\n"
        f"你的性格倾向是{personality}，所以你的好奇心{curiosity}。\n"
        "回答要简短可爱（1-2句话），像一只活泼的小宠物。\n"
        "用口语化表达，可以用~和颜文字。"
    )
    return prompt
