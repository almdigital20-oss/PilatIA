"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import "./ai-onboarding.css";

export type AiProfile = {
  companyName: string;
  city: string;
  address: string;
  businessHours: string;
  services: string;
  prices: string;
  availablePeriods: string;
  cancellationPolicy: string;
  differentials: string;
  faq: string;
  toneGuidelines: string;
  serviceHowItWorks: string;
  firstExperience: string;
  paymentMethods: string;
  promotionText: string;
  promotionExpiresAt: string;
  assistantGreeting: string;
  emojiStyle: "none" | "light" | "expressive";
  commercialGoal: string;
  handoffInstructions: string;
  qualificationQuestions: string[];
  onboardingComplete: boolean;
  demo?: boolean;
};

const checks = (profile: AiProfile) => [
  {
    label: "Identidade",
    done: Boolean(profile.companyName && profile.toneGuidelines),
  },
  { label: "Como funciona", done: Boolean(profile.serviceHowItWorks) },
  { label: "Primeira experiência", done: Boolean(profile.firstExperience) },
  { label: "Serviços", done: Boolean(profile.services) },
  {
    label: "Funcionamento",
    done: Boolean(profile.businessHours && profile.availablePeriods),
  },
  { label: "Valores protegidos", done: Boolean(profile.prices) },
  { label: "Pagamento", done: Boolean(profile.paymentMethods) },
  {
    label: "Transferência",
    done: Boolean(profile.handoffInstructions || profile.commercialGoal),
  },
];

export function readiness(profile: AiProfile) {
  const items = checks(profile);
  return {
    score: Math.round(
      (items.filter((item) => item.done).length / items.length) * 100,
    ),
    items,
  };
}

export function AiReadinessCard({
  profile,
  onOpen,
  onTest,
}: {
  profile: AiProfile;
  onOpen: () => void;
  onTest: () => void;
}) {
  const status = readiness(profile);
  return (
    <section className="ai-readiness">
      <div
        className="readiness-score"
        style={{ "--score": `${status.score * 3.6}deg` } as React.CSSProperties}
      >
        <strong>{status.score}%</strong>
      </div>
      <div>
        <span>QUALIDADE DO ATENDIMENTO</span>
        <h3>
          {status.score >= 85
            ? "Sua IA está muito bem preparada"
            : status.score >= 50
              ? "Sua IA já atende e pode ficar ainda melhor"
              : "Sua IA está pronta com o modelo padrão"}
        </h3>
        <p>
          O WhatsApp continua funcionando normalmente. Complete apenas o que
          fizer sentido para personalizar as respostas.
        </p>
      </div>
      <div className="readiness-actions">
        <button onClick={onTest}>Testar minha IA</button>
        <button className="primary" onClick={onOpen}>
          Melhorar em 5 minutos
        </button>
      </div>
    </section>
  );
}

const steps = [
  "Identidade",
  "Experiência",
  "Serviços",
  "Comercial",
  "Operação",
  "Objetivo",
];

export function AiOnboardingModal({
  profile,
  onChange,
  onClose,
  onSave,
  onTest,
}: {
  profile: AiProfile;
  onChange: (profile: AiProfile) => void;
  onClose: () => void;
  onSave: () => Promise<boolean>;
  onTest: () => void;
}) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<
    "idle" | "pending" | "saving" | "saved" | "error"
  >("idle");
  const initialized = useRef(false);
  const lastSaved = useRef(JSON.stringify(profile));
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const draftKey = `pilatia_ai_draft_${profile.companyName || "company"}`;
  const status = readiness(profile);
  const set = (changes: Partial<AiProfile>) =>
    onChange({ ...profile, ...changes });
  useEffect(() => {
    try {
      const draft = window.localStorage.getItem(draftKey);
      if (draft) onChange({ ...profile, ...JSON.parse(draft) });
    } catch {}
    initialized.current = true;
  }, [draftKey]);
  useEffect(() => {
    if (!initialized.current || profile.demo) return;
    const fingerprint = JSON.stringify(profile);
    if (fingerprint === lastSaved.current) return;
    window.localStorage.setItem(draftKey, JSON.stringify(profile));
    setSaveState("pending");
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      const saved = await saveRef.current();
      if (saved) {
        lastSaved.current = fingerprint;
        window.localStorage.removeItem(draftKey);
        setSaveState("saved");
      } else setSaveState("error");
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [profile, draftKey]);
  const finish = async () => {
    setSaving(true);
    setSaveState("saving");
    const saved = await onSave();
    setSaving(false);
    if (saved) {
      window.localStorage.removeItem(draftKey);
      setSaveState("saved");
      onClose();
    } else setSaveState("error");
  };
  const saveAndTest = async () => {
    setSaving(true);
    setSaveState("saving");
    const saved = await onSave();
    setSaving(false);
    if (saved) {
      window.localStorage.removeItem(draftKey);
      setSaveState("saved");
      onTest();
    } else setSaveState("error");
  };
  return (
    <div className="modal-backdrop onboarding-backdrop" onMouseDown={onClose}>
      <section
        className="onboarding-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose}>
          ×
        </button>
        <aside>
          <div className="onboarding-brand">P</div>
          <span>CONFIGURAÇÃO RÁPIDA</span>
          <h2>Deixe sua IA com a cara da empresa</h2>
          <p>
            O atendimento já está ativo. Estas informações apenas tornam as
            respostas mais precisas.
          </p>
          <div className="onboarding-progress">
            <i>
              <em style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
            </i>
            <small>
              Etapa {step + 1} de {steps.length}
            </small>
          </div>
          <nav>
            {steps.map((label, index) => (
              <button
                key={label}
                className={
                  index === step ? "active" : index < step ? "done" : ""
                }
                onClick={() => setStep(index)}
              >
                <i>{index < step ? "✓" : index + 1}</i>
                {label}
              </button>
            ))}
          </nav>
          <div className="onboarding-quality">
            <b>{status.score}% personalizada</b>
            <span>
              {status.items.filter((item) => item.done).length}/
              {status.items.length} pontos configurados
            </span>
          </div>
        </aside>
        <article>
          <header>
            <span>PASSO {step + 1}</span>
            <h3>{steps[step]}</h3>
          </header>
          <div className="onboarding-fields">
            {step === 0 && (
              <>
                <label>
                  Como a IA deve se apresentar
                  <input
                    value={profile.assistantGreeting}
                    onChange={(event) =>
                      set({ assistantGreeting: event.target.value })
                    }
                    placeholder={`Olá! Sou a assistente de atendimento da ${profile.companyName || "sua empresa"}.`}
                  />
                </label>
                <label>
                  Tom da conversa
                  <textarea
                    value={profile.toneGuidelines}
                    onChange={(event) =>
                      set({ toneGuidelines: event.target.value })
                    }
                    placeholder="Acolhedor, objetivo e profissional"
                  />
                </label>
                <div className="choice-field">
                  <span>Uso de emojis</span>
                  {[
                    ["none", "Sem emojis"],
                    ["light", "Leve"],
                    ["expressive", "Mais caloroso"],
                  ].map(([value, label]) => (
                    <button
                      className={profile.emojiStyle === value ? "active" : ""}
                      key={value}
                      onClick={() =>
                        set({ emojiStyle: value as AiProfile["emojiStyle"] })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <label>
                  Como funciona o serviço
                  <textarea
                    value={profile.serviceHowItWorks}
                    onChange={(event) =>
                      set({ serviceHowItWorks: event.target.value })
                    }
                    placeholder="Explique de forma simples como funciona o atendimento, as aulas ou sessões."
                  />
                </label>
                <label>
                  Como é a primeira experiência
                  <textarea
                    value={profile.firstExperience}
                    onChange={(event) =>
                      set({ firstExperience: event.target.value })
                    }
                    placeholder="Ex.: começamos com uma avaliação individual para entender objetivos e necessidades."
                  />
                </label>
                <label>
                  Diferenciais importantes
                  <textarea
                    value={profile.differentials}
                    onChange={(event) =>
                      set({ differentials: event.target.value })
                    }
                    placeholder="O que torna a empresa especial?"
                  />
                </label>
              </>
            )}
            {step === 2 && (
              <>
                <label>
                  Serviços oferecidos
                  <textarea
                    value={profile.services}
                    onChange={(event) => set({ services: event.target.value })}
                    placeholder="Um por linha, com uma explicação curta quando necessário."
                  />
                </label>
                <label>
                  Perguntas frequentes
                  <textarea
                    value={profile.faq}
                    onChange={(event) => set({ faq: event.target.value })}
                    placeholder="Roupas, duração, público, orientações e dúvidas comuns."
                  />
                </label>
                <div className="onboarding-tip">
                  A IA nunca inventará um serviço. Ela utilizará somente o que
                  estiver informado aqui.
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <label>
                  Valores e planos autorizados
                  <textarea
                    value={profile.prices}
                    onChange={(event) => set({ prices: event.target.value })}
                    placeholder="Deixe vazio se preferir que a equipe informe os valores."
                  />
                </label>
                <label>
                  Formas de pagamento
                  <textarea
                    value={profile.paymentMethods}
                    onChange={(event) =>
                      set({ paymentMethods: event.target.value })
                    }
                    placeholder="Ex.: Pix, cartão e boleto. Informe regras de reserva, se existirem."
                  />
                </label>
                <label>
                  Promoção ativa
                  <textarea
                    value={profile.promotionText}
                    onChange={(event) =>
                      set({ promotionText: event.target.value })
                    }
                    placeholder="Condição, valor e quem pode utilizar."
                  />
                </label>
                <label>
                  Validade da promoção
                  <input
                    type="date"
                    value={profile.promotionExpiresAt}
                    onChange={(event) =>
                      set({ promotionExpiresAt: event.target.value })
                    }
                  />
                </label>
                <div className="onboarding-tip safe">
                  Promoções vencidas deixam de ser utilizadas automaticamente.
                </div>
              </>
            )}
            {step === 4 && (
              <>
                <div className="field-pair">
                  <label>
                    Cidade
                    <input
                      value={profile.city}
                      onChange={(event) => set({ city: event.target.value })}
                    />
                  </label>
                  <label>
                    Endereço
                    <input
                      value={profile.address}
                      onChange={(event) => set({ address: event.target.value })}
                    />
                  </label>
                </div>
                <label>
                  Horário de funcionamento
                  <textarea
                    value={profile.businessHours}
                    onChange={(event) =>
                      set({ businessHours: event.target.value })
                    }
                  />
                </label>
                <label>
                  Períodos normalmente disponíveis
                  <textarea
                    value={profile.availablePeriods}
                    onChange={(event) =>
                      set({ availablePeriods: event.target.value })
                    }
                  />
                </label>
                <label>
                  Política de cancelamento
                  <textarea
                    value={profile.cancellationPolicy}
                    onChange={(event) =>
                      set({ cancellationPolicy: event.target.value })
                    }
                  />
                </label>
              </>
            )}
            {step === 5 && (
              <>
                <label>
                  Principal objetivo comercial
                  <textarea
                    value={profile.commercialGoal}
                    onChange={(event) =>
                      set({ commercialGoal: event.target.value })
                    }
                    placeholder="Ex.: entender a necessidade e encaminhar interessados em começar para confirmação de horário."
                  />
                </label>
                <label>
                  Quando e como transferir para a equipe
                  <textarea
                    value={profile.handoffInstructions}
                    onChange={(event) =>
                      set({ handoffInstructions: event.target.value })
                    }
                    placeholder="Ex.: transferir quando souber objetivo, momento para começar e período preferido."
                  />
                </label>
                <div className="completion-checks">
                  {status.items.map((item) => (
                    <span className={item.done ? "done" : ""} key={item.label}>
                      <i>{item.done ? "✓" : "○"}</i>
                      {item.label}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
          <footer>
            <button onClick={step === 0 ? onClose : () => setStep(step - 1)}>
              {step === 0 ? "Fazer depois" : "Voltar"}
            </button>
            <div>
              {step === steps.length - 1 && (
                <button disabled={saving} onClick={saveAndTest}>
                  Salvar e testar
                </button>
              )}
              <button
                className="primary"
                disabled={saving}
                onClick={
                  step === steps.length - 1 ? finish : () => setStep(step + 1)
                }
              >
                {saving
                  ? "Salvando…"
                  : step === steps.length - 1
                    ? "Salvar e concluir"
                    : "Continuar"}
              </button>
            </div>
          </footer>
        </article>
      </section>
    </div>
  );
}

type TestMessage = { role: "user" | "assistant"; content: string };
const renderWhatsAppText = (text: string) =>
  text
    .split(/(\*[^*]+\*)/g)
    .map((part, index) =>
      part.startsWith("*") && part.endsWith("*") ? (
        <strong key={index}>{part.slice(1, -1)}</strong>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      ),
    );
const testSuggestions = [
  "Como funciona?",
  "Quanto custa?",
  "Como é o pagamento?",
  "Quero começar esta semana.",
];

export function AiSimulatorModal({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (text = draft) => {
    const clean = text.trim();
    if (!clean || busy) return;
    const next = [...messages, { role: "user" as const, content: clean }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch("/api/ai-simulator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: clean, history: messages }),
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") || "";
      const data = contentType.includes("application/json")
        ? await response.json()
        : null;
      const reply = response.ok
        ? String(data?.reply || "").trim()
        : String(data?.error || "").trim();
      setMessages([
        ...next,
        {
          role: "assistant",
          content:
            reply ||
            "Não foi possível concluir este teste agora. Tente novamente em alguns instantes.",
        },
      ]);
    } catch (error) {
      const timedOut =
        error instanceof DOMException && error.name === "AbortError";
      setMessages([
        ...next,
        {
          role: "assistant",
          content: timedOut
            ? "O teste demorou mais que o esperado. Tente novamente em alguns instantes."
            : "Não foi possível conectar ao simulador agora. Verifique sua conexão e tente novamente.",
        },
      ]);
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  };
  const lastAssistant = useMemo(
    () =>
      [...messages].reverse().find((message) => message.role === "assistant"),
    [messages],
  );
  return (
    <div className="modal-backdrop simulator-backdrop" onMouseDown={onClose}>
      <section
        className="simulator-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>AMBIENTE DE TESTE</span>
            <h2>Converse com sua IA</h2>
            <p>
              Nenhuma mensagem será enviada ao WhatsApp e este teste não cria um
              lead.
            </p>
          </div>
          <button onClick={onClose}>×</button>
        </header>
        <div className="simulator-suggestions">
          {testSuggestions.map((suggestion) => (
            <button key={suggestion} onClick={() => send(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
        <div className="simulator-chat">
          {messages.length ? (
            messages.map((message, index) => (
              <div className={message.role} key={`${message.role}-${index}`}>
                <small>
                  {message.role === "user" ? "Cliente de teste" : "Sua IA"}
                </small>
                <p>{message.role === "assistant" ? renderWhatsAppText(String(message.content || "")) : message.content}</p>
              </div>
            ))
          ) : (
            <div className="simulator-empty">
              <div>P</div>
              <strong>Faça uma pergunta como se fosse um cliente</strong>
              <p>
                Teste funcionamento, preço, pagamento, horários ou intenção de
                agendamento.
              </p>
            </div>
          )}
          {busy && (
            <div className="assistant typing">
              <i />
              <i />
              <i />
            </div>
          )}
        </div>
        {lastAssistant && (
          <div className="simulator-note">
            Confira se a resposta utiliza somente informações autorizadas da
            empresa.
          </div>
        )}
        <footer>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder="Digite uma mensagem de teste…"
          />
          <button disabled={busy} onClick={() => send()}>
            Enviar
          </button>
        </footer>
      </section>
    </div>
  );
}
