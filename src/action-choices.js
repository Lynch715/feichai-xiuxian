/**
 * 将完整行动表整理成对话式的编号主选项，移动已脱离回合，改由地点菜单处理。
 */
export function selectTurnChoices(actions, limit = 4) {
  return {
    numberedActions: actions.filter((action) => !action.freeInput).slice(0, limit),
    freeAction: actions.find((action) => action.freeInput) || null,
  };
}
