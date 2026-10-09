export type FollowupObjective = "recovery" | "reschedule";

export function followupText(objective: FollowupObjective, attempt: number, contactName: string, companyName: string) {
  const firstName = contactName.trim().split(/\s+/)[0];
  const hello = firstName ? `Oi, ${firstName}!` : "Oi!";
  const messages = objective === "reschedule" ? [
    `${hello} Posso te ajudar a encontrar um novo horário na ${companyName}? Me diga se prefere manhã, tarde ou noite.`,
    `${hello} Passando para facilitar seu agendamento. Se quiser, posso deixar nossa equipe te chamar com as melhores opções de horário.`,
    `${hello} Ainda quer reservar um horário na ${companyName}? Se fizer sentido para você, responda por aqui e retomamos de onde paramos.`,
  ] : [
    `${hello} Vi que nossa conversa ficou pendente. Quer que eu continue te ajudando por aqui?`,
    `${hello} Ficou alguma dúvida que eu possa esclarecer? Posso também chamar nossa equipe para te orientar melhor.`,
    `${hello} Se ainda fizer sentido para você, responda por aqui e retomamos nossa conversa de onde paramos.`,
  ];
  return messages[Math.max(0, Math.min(2, attempt - 1))];
}
