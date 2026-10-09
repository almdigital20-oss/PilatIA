export const businessTypes = [
  { id: "pilates", label: "Estúdio de Pilates", shortLabel: "Pilates", serviceName: "Pilates", appointmentNoun: "aula", experienceQuestion: "Você já fez Pilates antes ou seria sua primeira experiência?", motivationQuestion: "O que mais motivou você a procurar Pilates: dor ou indicação médica, postura, fortalecimento ou qualidade de vida?", focus: "experiência, dor ou indicação médica, postura, fortalecimento, qualidade de vida e disponibilidade" },
  { id: "personal", label: "Estúdio de personal", shortLabel: "Personal", serviceName: "treino personalizado", appointmentNoun: "treino", experienceQuestion: "Você já fez acompanhamento com personal trainer antes?", motivationQuestion: "Qual é seu principal objetivo: emagrecimento, fortalecimento, condicionamento ou qualidade de vida?", focus: "experiência com treino, objetivo físico, rotina, momento para começar e disponibilidade" },
  { id: "academia", label: "Academia", shortLabel: "Academia", serviceName: "treinos na academia", appointmentNoun: "avaliação", experienceQuestion: "Você já treina ou seria seu primeiro contato com uma academia?", motivationQuestion: "Qual é seu principal objetivo: emagrecimento, ganho de massa, condicionamento ou saúde?", focus: "experiência, objetivo, frequência desejada, momento para começar e disponibilidade" },
  { id: "funcional", label: "Treinamento funcional", shortLabel: "Funcional", serviceName: "treinamento funcional", appointmentNoun: "aula", experienceQuestion: "Você já fez treinamento funcional antes?", motivationQuestion: "Qual é seu principal objetivo: condicionamento, emagrecimento, fortalecimento ou qualidade de vida?", focus: "experiência, objetivo, condicionamento atual, momento para começar e disponibilidade" },
  { id: "fisioterapia", label: "Fisioterapia e movimento", shortLabel: "Fisioterapia", serviceName: "fisioterapia", appointmentNoun: "avaliação", experienceQuestion: "Você já fez fisioterapia ou algum acompanhamento semelhante antes?", motivationQuestion: "O que motivou sua busca: dor, recuperação, mobilidade, prevenção ou qualidade de vida?", focus: "queixa ou objetivo, indicação profissional, limitações relatadas, urgência e disponibilidade; nunca diagnosticar" },
  { id: "yoga", label: "Yoga e bem-estar", shortLabel: "Yoga", serviceName: "yoga", appointmentNoun: "aula", experienceQuestion: "Você já praticou yoga antes ou seria sua primeira experiência?", motivationQuestion: "O que você busca principalmente: reduzir estresse, flexibilidade, mobilidade ou qualidade de vida?", focus: "experiência, objetivo de bem-estar, rotina, momento para começar e disponibilidade" },
  { id: "saude_bem_estar", label: "Saúde e bem-estar", shortLabel: "Bem-estar", serviceName: "serviços de saúde e bem-estar", appointmentNoun: "avaliação", experienceQuestion: "Você já teve contato com esse tipo de atendimento antes?", motivationQuestion: "Qual necessidade ou objetivo fez você procurar esse atendimento agora?", focus: "necessidade principal, objetivo, momento para começar e disponibilidade, sem diagnóstico ou promessa clínica" },
] as const;

export type BusinessType = typeof businessTypes[number]["id"];
export type BusinessProfile = typeof businessTypes[number];

export function getBusinessProfile(value: unknown): BusinessProfile {
  return businessTypes.find((item) => item.id === value) || businessTypes[0];
}

export function isBusinessType(value: unknown): value is BusinessType {
  return businessTypes.some((item) => item.id === value);
}
