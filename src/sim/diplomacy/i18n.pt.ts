import { EVENTS } from './events';

const base: Record<string, string> = {
  // actions
  'dip.action.improve': 'Melhorar relações', 'dip.action.trade': 'Acordo comercial', 'dip.action.nap': 'Pacto de não agressão',
  'dip.action.access': 'Acesso militar', 'dip.action.alliance': 'Aliança defensiva', 'dip.action.guarantee': 'Garantir independência',
  'dip.action.embargo': 'Embargo', 'dip.action.tribute': 'Exigir tributo', 'dip.action.territory': 'Exigir território',
  'dip.action.rebels': 'Apoiar rebeldes', 'dip.action.declareWar': 'Declarar guerra', 'dip.action.peace': 'Propor paz',
  'dip.action.callAllies': 'Chamar aliados', 'dip.action.sanction': 'Propor sanção na Assembleia',
  // acceptance factors
  'dip.f.relation': 'Relação atual', 'dip.f.base': 'Disposição básica', 'dip.f.bloc': 'Blocos em comum', 'dip.f.rivalry': 'Rivalidade',
  'dip.f.reputation': 'Reputação internacional', 'dip.f.commonEnemies': 'Inimigos em comum', 'dip.f.power': 'Poder militar relativo', 'dip.f.atWar': 'Alvo ocupado em outras guerras',
  // errors
  'dip.err.self': 'Escolha outro país.', 'dip.err.dead': 'Seu país não pode agir.', 'dip.err.targetDead': 'O país alvo não existe mais.',
  'dip.err.atWar': 'Indisponível: países em guerra.', 'dip.err.cooldown': 'Aguarde antes de repetir esta ação.', 'dip.err.noMoney': 'Dinheiro insuficiente ({cost} M).',
  'dip.err.overlord': 'Não contra o seu suserano.', 'dip.err.already': 'Já em vigor ou já pendente.', 'dip.err.embargoed': 'Há um embargo contra você.',
  'dip.err.embargoing': 'Você mantém um embargo contra este país.', 'dip.err.relationTooLow': 'Relação mínima exigida: {need}.',
  'dip.err.allied': 'Não contra um aliado.', 'dip.err.badProvince': 'Província inválida.', 'dip.err.notAdjacent': 'A província precisa fazer fronteira com você.',
  'dip.err.refused': 'Proposta recusada (chance era {chance}%).', 'dip.err.unknownCountry': 'País desconhecido.', 'dip.err.unknownTreaty': 'Tratado desconhecido.',
  'dip.err.noTreaty': 'Não há tratado desse tipo.', 'dip.err.notOnPlayer': 'Ação não aplicável a você.', 'dip.err.inboxFull': 'Caixa de propostas cheia.',
  'dip.err.noProposal': 'Proposta inexistente.', 'dip.err.badCb': 'Casus belli inválido.', 'dip.err.sandboxPeace': 'Modo sandbox: a IA não ataca o jogador.',
  'dip.err.noStrongCb': 'Sem casus belli forte contra o jogador.', 'dip.err.nap': 'Há um pacto de não agressão em vigor (cancele-o ou use força).',
  'dip.err.truce': 'Trégua em vigor.', 'dip.err.noWar': 'Guerra inexistente.', 'dip.err.notInWar': 'Você não participa desta guerra.',
  'dip.err.notLeader': 'Só o líder do lado pode chamar aliados.', 'dip.err.notAllied': 'Você não é aliado do líder deste lado.',
  'dip.err.alliedEnemy': 'Você é aliado do lado inimigo.', 'dip.err.scoreTooLow': 'Placar insuficiente para exigir termos.',
  'dip.err.noConference': 'Conferência inexistente.', 'dip.err.badOption': 'Opção de paz inválida.', 'dip.err.voteOpen': 'Já há uma votação aberta.',
  'dip.err.cantSanction': 'Não é possível abrir esta votação agora.', 'dip.err.noVote': 'Nenhuma votação aberta.', 'dip.err.notPlayer': 'Apenas o jogador vota.',
  'dip.err.noEvent': 'Evento inexistente.', 'dip.err.badChoice': 'Escolha inválida.',
  // casus belli
  'dip.cb.none': 'Sem casus belli', 'dip.cb.rivalry': 'Rivalidade histórica', 'dip.cb.embargo': 'Embargo sofrido', 'dip.cb.sanctioned': 'Alvo sancionado pela Assembleia',
  'dip.cb.territorial': 'Território ocupado', 'dip.cb.allyAttacked': 'Defesa de aliado', 'dip.cb.grievance': 'Afronta diplomática', 'dip.cb.nuclear': 'Uso de armas nucleares',
  'dip.cb.historical': 'Conflito em curso',
  // causes
  'dip.cause.war': 'Guerra', 'dip.cause.unprovoked': 'Agressão sem provocação', 'dip.cause.tradeDeal': 'Acordo comercial', 'dip.cause.nap': 'Pacto de não agressão',
  'dip.cause.access': 'Acesso militar', 'dip.cause.alliance': 'Aliança', 'dip.cause.guarantee': 'Garantia de independência', 'dip.cause.cancelled': 'Tratado cancelado',
  'dip.cause.improve': 'Gestos diplomáticos', 'dip.cause.embargo': 'Embargo', 'dip.cause.embargoLifted': 'Embargo suspenso', 'dip.cause.rebels': 'Apoio a rebeldes',
  'dip.cause.demandRefused': 'Exigência recusada', 'dip.cause.tribute': 'Tributo exigido', 'dip.cause.territory': 'Cessão forçada de território',
  'dip.cause.declined': 'Proposta recusada', 'dip.cause.peace': 'Termos de paz', 'dip.cause.sanctionProposed': 'Sanção proposta', 'dip.cause.nuked': 'Ataque nuclear',
  'dip.cause.nukeUse': 'Uso de armas nucleares', 'dip.cause.contacts': 'Contatos diplomáticos',
  // costs / unrest
  'dip.cost.improve': 'Custo diplomático', 'dip.cost.rebels': 'Apoio a rebeldes', 'dip.cost.tribute': 'Tributo pago', 'dip.income.tribute': 'Tributo recebido',
  'dip.cost.reparations': 'Reparações pagas', 'dip.income.reparations': 'Reparações recebidas', 'dip.unrest.rebels': 'Rebeldes apoiados do exterior',
  'dip.unrest.regimeChange': 'Mudança de regime imposta',
  // peace
  'dip.peace.annexAll': 'Anexar tudo', 'dip.peace.annexOccupied': 'Anexar território ocupado', 'dip.peace.puppet': 'Fantoche', 'dip.peace.regime': 'Mudar regime',
  'dip.peace.reparations': 'Reparações', 'dip.peace.white': 'Paz branca',
  // votes
  'dip.vote.proposed': 'Proposta de sanção', 'dip.vote.aggression': 'Agressão sem casus belli', 'dip.vote.nuclear': 'Uso de armas nucleares',
  // news
  'dip.news.warDeclared': '{a} declarou guerra a {b} ({cb}).', 'dip.news.joined': '{country} entrou na guerra ao lado de {leader}.',
  'dip.news.capitulated': '{country} capitulou diante de {by}.', 'dip.news.warEnded': 'Fim da guerra entre {a} e {b}.',
  'dip.news.peace.annexAll': '{winner} anexou todo o território de {loser}.', 'dip.news.peace.annexOccupied': '{winner} anexou território ocupado de {loser}.',
  'dip.news.peace.puppet': '{loser} tornou-se Estado fantoche de {winner}.', 'dip.news.peace.regime': '{winner} impôs mudança de regime em {loser}.',
  'dip.news.peace.reparations': '{loser} pagará reparações a {winner}.', 'dip.news.peace.white': 'Paz branca entre {winner} e {loser}.',
  'dip.news.rebelsExposed': '{b} descobriu que {a} apoiava rebeldes em seu território.', 'dip.news.territoryCeded': '{a} cedeu {province} a {b}.',
  'dip.news.voteOpened': 'Assembleia Mundial: votação de sanção contra {target}, proposta por {proposer}.',
  'dip.news.sanctionPassed': 'Assembleia aprovou sanções contra {target} ({yes} a {no}).', 'dip.news.sanctionVetoed': 'Sanção contra {target} vetada por {veto}.',
  'dip.news.sanctionFailed': 'Sanção contra {target} rejeitada ({yes} a {no}).', 'dip.news.nuclearUse': 'ALERTA: {country} usou armas nucleares. Condenação mundial.',
};

const events: Record<string, { title: string; desc: string; news: string; c: Record<string, string> }> = {
  earthquake: { title: 'Terremoto', desc: 'Um forte terremoto atingiu uma de suas cidades.', news: 'Terremoto atinge {country}.', c: { rebuild: 'Reconstruir com recursos próprios', appealAid: 'Pedir ajuda internacional', ignore: 'Não fazer nada' } },
  flood: { title: 'Enchentes', desc: 'Chuvas extremas inundaram regiões agrícolas.', news: 'Enchentes em {country}.', c: { emergency: 'Plano de emergência', ignore: 'Deixar por conta dos estados' } },
  drought: { title: 'Seca severa', desc: 'A estiagem ameaça a safra.', news: 'Seca severa em {country}.', c: { importFood: 'Importar alimentos', ration: 'Racionar' } },
  pandemic: { title: 'Surto epidêmico', desc: 'Um surto infeccioso se espalha pelo país.', news: 'Surto epidêmico em {country}.', c: { lockdown: 'Restrições rígidas', staysOpen: 'Manter a economia aberta' } },
  financialCrisis: { title: 'Crise financeira', desc: 'Bancos em dificuldade e crédito escasso.', news: 'Crise financeira em {country}.', c: { bailout: 'Socorrer os bancos', austerity: 'Austeridade' } },
  oilShock: { title: 'Choque do petróleo', desc: 'O preço da energia disparou.', news: 'Choque de preços de energia afeta {country}.', c: { subsidize: 'Subsidiar combustíveis', passOn: 'Repassar ao consumidor' } },
  election: { title: 'Eleições', desc: 'O país vai às urnas.', news: 'Eleições em {country}.', c: { campaign: 'Campanha institucional', populist: 'Pacote popular', neutral: 'Não interferir' } },
  scandal: { title: 'Escândalo de corrupção', desc: 'Autoridades são acusadas de desvios.', news: 'Escândalo de corrupção em {country}.', c: { investigate: 'Investigar a fundo', coverUp: 'Abafar o caso' } },
  strikes: { title: 'Greves gerais', desc: 'Sindicatos paralisam setores-chave.', news: 'Greves gerais em {country}.', c: { negotiate: 'Negociar', repress: 'Reprimir' } },
  refugees: { title: 'Onda de refugiados', desc: 'Refugiados fogem da guerra em país vizinho.', news: 'Refugiados chegam à fronteira de {country}.', c: { accept: 'Acolher', closeBorder: 'Fechar a fronteira' } },
  breakthrough: { title: 'Avanço científico', desc: 'Pesquisadores nacionais fazem uma descoberta importante.', news: '{country} anuncia avanço científico.', c: { invest: 'Investir pesado', share: 'Compartilhar com o mundo' } },
  industrialAccident: { title: 'Acidente industrial', desc: 'Um grave acidente atingiu uma usina.', news: 'Acidente industrial em {country}.', c: { compensate: 'Indenizar vítimas', deny: 'Negar responsabilidade' } },
  cyberattack: { title: 'Ataque cibernético', desc: 'Hackers ligados a {other} atacaram sua infraestrutura.', news: 'Ataque cibernético contra {country}.', c: { harden: 'Reforçar defesas', retaliate: 'Retaliar', ignore: 'Ignorar' } },
  coupAttempt: { title: 'Tentativa de golpe', desc: 'Setores das forças armadas conspiram.', news: 'Tentativa de golpe em {country}.', c: { concessions: 'Fazer concessões', purge: 'Expurgar conspiradores' } },
  borderIncident: { title: 'Incidente de fronteira', desc: 'Tropas de {other} cruzaram a fronteira.', news: 'Incidente de fronteira envolvendo {country} e {other}.', c: { protest: 'Protesto diplomático', retaliate: 'Retaliar', ignoreIncident: 'Ignorar' } },
  summit: { title: 'Cúpula regional', desc: '{other} convida você para uma cúpula.', news: 'Cúpula regional reúne {country} e {other}.', c: { attend: 'Comparecer', skip: 'Recusar' } },
  volcano: { title: 'Erupção vulcânica', desc: 'Um vulcão entrou em erupção.', news: 'Erupção vulcânica em {country}.', c: { evacuate: 'Evacuar a região', ignore: 'Aguardar' } },
  bumperHarvest: { title: 'Safra recorde', desc: 'A colheita superou todas as expectativas.', news: 'Safra recorde em {country}.', c: { export: 'Exportar o excedente', stockpile: 'Formar estoques' } },
  energyDiscovery: { title: 'Descoberta energética', desc: 'Novas reservas foram encontradas.', news: '{country} descobre novas reservas de energia.', c: { develop: 'Explorar por conta própria', sellRights: 'Vender direitos' } },
  spyScandal: { title: 'Escândalo de espionagem', desc: 'Agentes de {other} foram flagrados.', news: 'Escândalo de espionagem entre {country} e {other}.', c: { expel: 'Expulsar diplomatas', denyScandal: 'Negar tudo' } },
};

export const diplomacyPt: Record<string, string> = { ...base };
for (const e of EVENTS) {
  const t = events[e.id];
  if (!t) continue;
  diplomacyPt[`dip.event.${e.id}.title`] = t.title;
  diplomacyPt[`dip.event.${e.id}.desc`] = t.desc;
  diplomacyPt[`dip.event.${e.id}.news`] = t.news;
  for (const [k, v] of Object.entries(t.c)) diplomacyPt[`dip.event.${e.id}.c.${k}`] = v;
}
