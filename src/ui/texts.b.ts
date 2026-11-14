/** pt-BR strings of the UI-B modules (diplomacy, research, military, tactical HUD, guide). */
import { aiPt } from '../sim/ai/i18n.pt';
import { addTexts } from './i18n';

const modk: Record<string, string> = {
  'eco.agri': 'Produção agrícola', 'eco.approval': 'Aprovação do governo', 'eco.buildCost': 'Custo de construção', 'eco.buildSpeed': 'Velocidade de construção',
  'eco.cyberDefense': 'Defesa cibernética', 'eco.disasterResist': 'Resistência a desastres', 'eco.electronics': 'Produção de eletrônicos', 'eco.energyDemand': 'Demanda de energia',
  'eco.gridLoss': 'Perdas na rede elétrica', 'eco.health': 'Saúde', 'eco.industry': 'Produção industrial', 'eco.manpower': 'Mão de obra', 'eco.mining': 'Mineração',
  'eco.nuclear': 'Energia nuclear', 'eco.oil': 'Produção de petróleo', 'eco.popGrowth': 'Crescimento populacional', 'eco.rareEarth': 'Terras raras', 'eco.research': 'Pesquisa',
  'eco.solar': 'Energia solar', 'eco.stability': 'Estabilidade', 'eco.storage': 'Armazenamento de energia', 'eco.taxEfficiency': 'Eficiência tributária', 'eco.trade': 'Comércio',
  'eco.unrest': 'Agitação social', 'eco.wind': 'Energia eólica',
  'mil.abm.intercept': 'Interceptação antibalística', 'mil.air.attack': 'Ataque aéreo', 'mil.air.defense': 'Defesa aérea', 'mil.air.range': 'Alcance aéreo', 'mil.amphibious': 'Operações anfíbias',
  'mil.armor.attack': 'Ataque dos blindados', 'mil.armor.defense': 'Defesa dos blindados', 'mil.artillery.accuracy': 'Precisão da artilharia', 'mil.artillery.range': 'Alcance da artilharia',
  'mil.blockade': 'Eficácia de bloqueio', 'mil.cyber': 'Guerra cibernética', 'mil.drone.attack': 'Ataque de drones', 'mil.entrench': 'Entrincheiramento', 'mil.ew': 'Guerra eletrônica',
  'mil.infantry.attack': 'Ataque da infantaria', 'mil.infantry.defense': 'Defesa da infantaria', 'mil.mech.attack': 'Ataque mecanizado', 'mil.missile.accuracy': 'Precisão de mísseis',
  'mil.missile.range': 'Alcance de mísseis', 'mil.missile.speed': 'Velocidade de mísseis', 'mil.naval.attack': 'Ataque naval', 'mil.naval.defense': 'Defesa naval', 'mil.naval.detect': 'Detecção naval',
  'mil.naval.speed': 'Velocidade naval', 'mil.nuke.yield': 'Potência nuclear', 'mil.org': 'Organização das tropas', 'mil.production': 'Produção militar', 'mil.radar.range': 'Alcance de radar',
  'mil.sam.intercept': 'Interceptação antiaérea', 'mil.speed': 'Velocidade das tropas', 'mil.sub.stealth': 'Furtividade de submarinos', 'mil.supply': 'Suprimento', 'mil.upkeep': 'Custo de manutenção militar',
  'mil.vision': 'Alcance de visão',
};
const build: Record<string, string> = {
  powerPlant: 'Gera eletricidade. Escolha o combustível conforme os recursos e a tecnologia do país.', civilFactory: 'Aumenta a produção industrial civil e bens de consumo.',
  militaryFactory: 'Fornece pontos de indústria militar para a fila de produção de unidades.', refinery: 'Converte petróleo em combustível e derivados.', mine: 'Extrai minérios (aço, terras raras, urânio).',
  farm: 'Aumenta a produção de alimentos.', hospital: 'Melhora a saúde e a satisfação da população.', university: 'Gera pontos de pesquisa e acelera a árvore tecnológica.',
  road: 'Liga cidades e acelera o movimento de tropas e o comércio.', railway: 'Transporte pesado de carga e suprimento.', port: 'Comércio marítimo e base naval.',
  airport: 'Base para aviação civil e militar.', militaryBase: 'Abriga e reabastece formações; ponto de reforço.', airDefense: 'Defende a região contra aeronaves e mísseis.',
  radar: 'Amplia a visão e o alerta antecipado.', silo: 'Lança mísseis balísticos e ogivas nucleares.', bunker: 'Fortificação que aumenta a defesa local.',
};
const res: Record<string, string> = {
  money: 'Moeda do jogo (milhões de US$). Financia construção, produção e manutenção.', energy: 'Eletricidade: oferta das usinas contra a demanda das cidades e indústrias.',
  oil: 'Combustível para veículos, aviões e navios; também gera energia.', food: 'Sustenta a população; falta causa descontentamento.', steel: 'Insumo de construção e de equipamentos militares.',
  electronics: 'Exigido por unidades modernas, radares e mísseis.', rareEarth: 'Insumo estratégico para eletrônicos avançados.', uranium: 'Combustível de reatores e ogivas nucleares.',
  munitions: 'Consumida em combate e na produção de armamentos.', consumerGoods: 'Mantém a satisfação da população.',
};

const dict: Record<string, string> = {
  'ui.panel.guide': 'Guia',
  // auto
  'ui.auto.res.auto': 'Pesquisa automática', 'ui.autoHelp.res.auto': 'Escolhe a próxima tecnologia quando a fila esvazia.', 'ui.autoHelp.mil.production': 'O governo mantém a produção de unidades conforme a necessidade militar.',
  // diplomacy
  'ui.dip.tab.countries': 'Países', 'ui.dip.tab.wars': 'Guerras', 'ui.dip.tab.pending': 'Pendências', 'ui.dip.tab.assembly': 'Assembleia',
  'ui.dip.search': 'Buscar país…', 'ui.dip.country': 'País', 'ui.dip.neighbor': 'Vizinho', 'ui.dip.none': 'Nenhum país encontrado.', 'ui.dip.you': 'você',
  'ui.dip.filter.nb': 'Vizinhos', 'ui.dip.filter.all': 'Todos', 'ui.dip.filter.war': 'Em guerra', 'ui.dip.filter.ally': 'Aliados',
  'ui.dip.embargoed': 'Embargo seu', 'ui.dip.cancelTreaty': 'Cancelar tratado', 'ui.dip.reputation': 'Reputação', 'ui.dip.relBase': 'Disposição estrutural', 'ui.dip.relDynamic': 'Eventos recentes',
  'ui.dip.actions': 'Ações diplomáticas', 'ui.dip.do': 'Executar', 'ui.dip.liftEmbargo': 'Suspender', 'ui.dip.chooseProvince': 'Escolher província', 'ui.dip.pickProvince': 'Clique na província a exigir',
  'ui.dip.territoryOf': 'Província escolhida: {p}', 'ui.dip.repHelp': 'Custo de reputação internacional por declarar a guerra com este casus belli.',
  'ui.dip.cbStrength.0': 'sem base', 'ui.dip.cbStrength.1': 'fraco', 'ui.dip.cbStrength.2': 'médio', 'ui.dip.cbStrength.3': 'forte', 'ui.dip.confirmWar': 'Confirmar guerra contra {c}',
  'ui.dip.tr.trade': 'Acordo comercial', 'ui.dip.tr.nap': 'Não agressão', 'ui.dip.tr.alliance': 'Aliança', 'ui.dip.tr.acc': 'Acesso militar', 'ui.dip.tr.guar': 'Garantia',
  'ui.dip.noWars': 'Seu país não está em guerra.', 'ui.dip.score': 'Placar de guerra', 'ui.dip.occupation': 'ocupação', 'ui.dip.worldWars': 'Guerras em curso no mundo: {n}',
  'ui.dip.nothingPending': 'Nenhuma proposta, conferência ou evento pendente.', 'ui.dip.openEvent': 'Abrir evento', 'ui.dip.until': 'até', 'ui.dip.accept': 'Aceitar', 'ui.dip.refuse': 'Recusar',
  'ui.dip.prop.trade': 'propõe acordo comercial', 'ui.dip.prop.nap': 'propõe pacto de não agressão', 'ui.dip.prop.access': 'pede acesso militar', 'ui.dip.prop.alliance': 'propõe aliança defensiva',
  'ui.dip.prop.guarantee': 'oferece garantir sua independência', 'ui.dip.prop.peace': 'propõe paz',
  'ui.dip.conference': 'Conferência de paz', 'ui.dip.confHelp': 'Você venceu e ocupa {occ} do território do derrotado. Escolha os termos da paz.',
  'ui.dip.myReputation': 'Sua opinião internacional', 'ui.dip.sanctionedYou': 'Sanções reduzem seu comércio em {p}.', 'ui.dip.vote': 'Votação na Assembleia', 'ui.dip.noVote': 'Nenhuma votação aberta.',
  'ui.dip.voteAgainst': 'Sanção contra {c}', 'ui.dip.proposedBy': 'proposta por {c}', 'ui.dip.voteYes': 'A favor', 'ui.dip.voteNo': 'Contra', 'ui.dip.activeSanctions': 'Sanções em vigor',
  'ui.dip.yourChoice': 'Sua decisão', 'ui.dip.eventDefault': 'Se você não decidir, a última opção é aplicada quando o prazo terminar.', 'ui.dip.fx.none': 'Sem efeitos adicionais',
  'ui.dip.fx.money': 'Custo {s}{v}% do PIB mensal', 'ui.dip.fx.unrest': 'Agitação {v} por {d} dias', 'ui.dip.fx.mod': '{k} {v} por {d} dias', 'ui.dip.fx.rel': 'Relação {v}', 'ui.dip.fx.rep': 'Reputação {v}',
  'ui.dip.fx.damage': 'Dano de {v}% em {k}', 'ui.dip.fx.city': 'uma cidade', 'ui.dip.fx.plant': 'uma usina',
  // research
  'ui.res.rate': 'Pesquisa', 'ui.res.ptsDay': 'pts/dia', 'ui.res.done': '{n} tecnologias concluídas', 'ui.res.current': 'Em pesquisa', 'ui.res.none': 'Nenhuma pesquisa em andamento.',
  'ui.res.queueLabel': 'Fila', 'ui.res.cost': 'Custo', 'ui.res.pts': 'pts', 'ui.res.requires': 'Requer', 'ui.res.start': 'Pesquisar agora', 'ui.res.queue': 'Enfileirar', 'ui.res.unqueue': 'Remover da fila',
  'ui.res.tier': 'Nível {n}', 'ui.res.br.army': 'Exército', 'ui.res.br.air': 'Aeronáutica', 'ui.res.br.navy': 'Marinha', 'ui.res.br.strategic': 'Estratégico', 'ui.res.br.economy': 'Economia', 'ui.res.br.society': 'Sociedade',
  // military
  'ui.mil.domain.land': 'Terrestres', 'ui.mil.domain.air': 'Aéreas', 'ui.mil.domain.naval': 'Navais', 'ui.mil.domain.missile': 'Mísseis',
  'ui.mil.order.idle': 'Parada', 'ui.mil.order.move': 'Em marcha', 'ui.mil.order.attack': 'Atacando', 'ui.mil.order.defend': 'Defendendo', 'ui.mil.order.blockade': 'Bloqueando', 'ui.mil.order.strike': 'Em missão',
  'ui.mil.order.retreat': 'Recuando', 'ui.mil.order.patrol': 'Patrulhando',
  'ui.mil.tab.forces': 'Formações', 'ui.mil.tab.strikes': 'Ataques', 'ui.mil.battles': 'Batalhas em curso', 'ui.mil.showOthers': 'Mostrar também forças visíveis de outros países',
  'ui.mil.noForces': 'Nenhuma formação visível.', 'ui.mil.cols': 'Colunas: força · organização · suprimento · ordem. Clique para selecionar e ir ao local.',
  'ui.mil.strength': 'Força', 'ui.mil.org': 'Organização', 'ui.mil.morale': 'Moral', 'ui.mil.supply': 'Suprimento', 'ui.mil.order': 'Ordem', 'ui.mil.xp': 'Experiência', 'ui.mil.entrench': 'Entrincheiramento',
  'ui.mil.eta': 'Chegada em', 'ui.mil.composition': 'Composição', 'ui.mil.carrying': 'Transporta {n} formação(ões).', 'ui.mil.nSelected': '{n} formações selecionadas', 'ui.mil.orders': 'Ordens',
  'ui.mil.move': 'Mover', 'ui.mil.attackMove': 'Atacar-mover', 'ui.mil.defend': 'Defender', 'ui.mil.retreat': 'Recuar', 'ui.mil.stop': 'Parar', 'ui.mil.blockade': 'Bloquear porto',
  'ui.mil.embark': 'Embarcar', 'ui.mil.disembark': 'Desembarcar', 'ui.mil.merge': 'Fundir', 'ui.mil.split': 'Dividir', 'ui.mil.rename': 'Renomear', 'ui.mil.noPort': 'Nenhum porto próximo ao ponto.',
  'ui.mil.pickDest': 'Clique no globo para escolher o destino', 'ui.mil.pickPort': 'Clique perto do porto a bloquear', 'ui.mil.pickTarget': 'Clique no globo perto do alvo',
  'ui.mil.splitHelp': 'Marque as unidades que formarão a nova formação.', 'ui.mil.mergeHelp': 'Escolha a formação que será incorporada a esta.', 'ui.mil.embarkHelp': 'Escolha o transporte.',
  'ui.mil.noNearby': 'Nenhuma formação sua por perto.',
  'ui.mil.strikeMission': 'Missão de ataque', 'ui.mil.launchStrike': 'Lançar ataque', 'ui.mil.targets': '{n} alvos ao alcance', 'ui.mil.chooseOnGlobe': 'Escolher no globo', 'ui.mil.noTargets': 'Sem alvos válidos ao alcance (é preciso estar em guerra).',
  'ui.mil.targetFormation': 'Formação inimiga', 'ui.mil.tk.city': 'Cidade', 'ui.mil.tk.plant': 'Usina', 'ui.mil.tk.airport': 'Aeroporto', 'ui.mil.tk.port': 'Porto', 'ui.mil.tk.road': 'Estrada', 'ui.mil.tk.formation': 'Formação',
  'ui.mil.vec.bomber': 'Bombardeiro', 'ui.mil.vec.drone': 'Drone', 'ui.mil.vec.cruise': 'Míssil de cruzeiro', 'ui.mil.vec.ballistic': 'Míssil balístico', 'ui.mil.vec.nuke': 'Nuclear',
  'ui.mil.vecHelp.bomber': 'Esquadrão de bombardeiros ataca e retorna à base.', 'ui.mil.vecHelp.drone': 'Drones de ataque: barato, alcance moderado.', 'ui.mil.vecHelp.cruise': 'Preciso, voa baixo; pode ser interceptado.',
  'ui.mil.vecHelp.ballistic': 'Alcance longo, difícil de interceptar.', 'ui.mil.vecHelp.nuke': 'Destrói o alvo, mata população e provoca reação mundial.', 'ui.mil.vecRange': 'Alcance {km} km',
  'ui.mil.noAirUnits': 'Você não tem formações desse tipo.', 'ui.mil.noMissiles': 'Sem estoque. Produza na aba Produção.',
  'ui.mil.nukeWarn': 'ATAQUE NUCLEAR — irreversível', 'ui.mil.nukeType': 'Mortes em massa, radiação e condenação mundial. Digite CONFIRMAR para liberar o lançamento.',
  'ui.mil.battle': 'Batalha', 'ui.mil.battleOver': 'Batalha encerrada', 'ui.mil.attackers': 'Atacantes', 'ui.mil.defenders': 'Defensores', 'ui.mil.forecast': 'Previsão', 'ui.mil.balance': 'balanço',
  'ui.mil.stalemate': 'Equilíbrio: sem desfecho previsto.', 'ui.mil.etaBreak': 'Um lado cede em cerca de {d} dias.', 'ui.mil.inTactical': 'Em comando tático', 'ui.mil.notParticipant': 'Você não participa desta batalha.',
  'ui.mil.commandBattle': 'Comandar batalha', 'ui.mil.autoResolve': 'Resolver automaticamente', 'ui.mil.autoResolving': 'A batalha será resolvida automaticamente enquanto o tempo corre.',
  // production
  'ui.prod.queue': 'Fila de produção', 'ui.prod.emptyQueue': 'Fila vazia.', 'ui.prod.waiting': 'aguardando', 'ui.prod.cancel': 'Cancelar', 'ui.prod.catalog': 'Catálogo de unidades', 'ui.prod.qty': 'Qtd.',
  'ui.prod.produce': 'Produzir', 'ui.prod.pts': 'pts de indústria', 'ui.prod.cost': 'Custo', 'ui.prod.needsTech': 'Requer pesquisa: {tech}', 'ui.prod.noResources': 'Recursos insuficientes',
  'ui.prod.men': 'Efetivo', 'ui.prod.range': 'Alcance', 'ui.prod.speed': 'Velocidade', 'ui.prod.upkeep': 'Manutenção/dia', 'ui.prod.cap': 'Capacidade de transporte',
  // intelligence
  'ui.intel.advice': 'Conselheiro', 'ui.intel.advisor': 'Conselheiros', 'ui.intel.apply': 'Aplicar', 'ui.intel.noAdvice': 'Sem recomendações no momento.', 'ui.intel.compare': 'Poder militar',
  'ui.intel.threat': 'Ameaça', 'ui.intel.threatHelp': 'Poder comparável ou superior ao seu e relação fria.', 'ui.intel.threats': 'Forças hostis em seu território', 'ui.intel.noThreats': 'Nenhuma força hostil visível em seu território.',
  'ui.intel.arsenal': 'Arsenal de ataque',
  // tactical
  'ui.tac.yourSide': 'Seus esquadrões', 'ui.tac.enemy': 'Inimigo', 'ui.tac.men': 'Efetivo', 'ui.tac.morale': 'Moral', 'ui.tac.ammo': 'Munição', 'ui.tac.routed': 'em debandada', 'ui.tac.destroyed': 'destruído',
  'ui.tac.ord.idle': 'parado', 'ui.tac.ord.move': 'movendo', 'ui.tac.ord.amove': 'atacar-mover', 'ui.tac.ord.attack': 'atacando', 'ui.tac.ord.hold': 'mantendo', 'ui.tac.ord.retreat': 'recuando',
  'ui.tac.selectFirst': 'Selecione esquadrões primeiro.', 'ui.tac.pickDest': 'Clique no terreno para o destino', 'ui.tac.pickEnemy': 'Clique perto do inimigo a atacar', 'ui.tac.pickFront': 'Clique na direção da frente',
  'ui.tac.pick.artillery': 'Clique no ponto do bombardeio de artilharia', 'ui.tac.pick.airstrike': 'Clique no ponto do ataque aéreo', 'ui.tac.pick.drone': 'Clique no ponto do ataque de drone',
  'ui.tac.ready': 'Pronto', 'ui.tac.waiting': 'Aguardando o inimigo', 'ui.tac.withdraw': 'Retirar', 'ui.tac.withdrawConfirm': 'Confirmar retirada', 'ui.tac.timeLeft': 'Tempo decorrido', 'ui.tac.left': 'restam',
  'ui.tac.score': 'Placar', 'ui.tac.objective': 'Objetivo', 'ui.tac.deployHelp': 'Implantação: posicione seus esquadrões na zona azul e clique em Pronto.',
  'ui.tac.resultTitle': 'Resultado da batalha', 'ui.tac.casualties': 'Baixas', 'ui.tac.you': 'você', 'ui.tac.collateral': 'Dano colateral à região: {p}', 'ui.tac.backToMap': 'Voltar ao mapa',
  // guide
  'ui.guide.search': 'Buscar…', 'ui.guide.units': 'Unidades', 'ui.guide.buildings': 'Construções', 'ui.guide.techs': 'Tecnologias', 'ui.guide.resources': 'Recursos', 'ui.guide.base': 'Disponível desde o início',
  'ui.guide.requires': 'Requer', 'ui.guide.unitStats': 'Poder de fogo — leve {soft} · blindado {hard} · aéreo {air} · naval {naval} · defesa {def} · alcance {range} km · visão {vis} km · efetivo {men}',
  'ui.tut.title': 'Primeiros passos ({n}/{total})', 'ui.tut.next': 'Próximo', 'ui.tut.finish': 'Concluir', 'ui.tut.dismiss': 'Dispensar guia', 'ui.tut.open': 'Abrir painel', 'ui.tut.done': 'Feito', 'ui.tut.restart': 'Rever tutorial',
  'ui.tut.pause': 'O tempo corre sozinho. Use a barra de espaço ou os botões do topo para pausar e escolher a velocidade; o jogo começa pausado.',
  'ui.tut.budget': 'Abra o Orçamento: ajuste impostos e gastos por pilar. Cuidado com déficit e dívida.',
  'ui.tut.plant': 'Em Construção, edifique uma usina (ou outra estrutura) numa província sua. Falta de energia causa apagões.',
  'ui.tut.research': 'Em Pesquisa, enfileire uma tecnologia. Ela libera unidades, construções e bônus.',
  'ui.tut.move': 'Em Forças Armadas, selecione uma formação e use Mover para escolher o destino no globo (ou clique direito no mapa).',
  'ui.tut.diplomacy': 'Abra Diplomacia, escolha um país e veja as chances de cada ação antes de agir.',
};
for (const [k, v] of Object.entries(modk)) dict[`ui.modk.${k}`] = v;
for (const [k, v] of Object.entries(build)) dict[`ui.guide.build.${k}`] = v;
for (const [k, v] of Object.entries(res)) dict[`ui.guide.res.${k}`] = v;
addTexts({ ...aiPt, ...dict });
