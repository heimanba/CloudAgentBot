import { useState } from "react";
import type { ChatTimelineItemView } from "@shared/models";
import { BotsPage } from "./features/bots/bots-page";
import { TeamTemplateCreation } from "./features/bots/team-template-creation";
import { BotSettingsForm } from "./features/bots/bot-settings-form";
import { ChatDetailPage } from "./features/chats/chat-detail-page";
import { ChatsPage } from "./features/chats/chats-page";
import { ChatsOverviewPage } from "./features/chats/chats-overview-page";
import { NewTaskPage } from "./features/chats/new-task-page";
import { cn } from "./lib/utils";
import { Sheet } from "./ui/design-system";
import { AppSidebar } from "./shell/app-sidebar";
import { ConnectionsGate } from "./shell/connections-gate";
import { MobileChatNavigation } from "./shell/mobile-chat-navigation";
import { useWorkspace } from "./shell/use-workspace";
import { WorkspaceHeader } from "./shell/workspace-header";
import { chatKey } from "./shell/chat-navigation-model";
import { WorkspaceResizer } from "./shell/workspace-resizer";
import { ArtifactWorkspace } from "./features/chats/artifact-workspace";
import { useDeploymentRunWatcher } from "./features/deployments/use-deployment-run-watcher";
import { DeploymentsPage } from "./features/deployments/deployments-page";

export default function App() {
  const workspace = useWorkspace();
  const { selectedBot, selectedChat } = workspace;
  useDeploymentRunWatcher(
    workspace.activeConnection?.id ?? null,
    workspace.activeConnection?.provider,
    () => {
      // 定时任务跑出/跑完新会话：刷新侧栏 roster 与 Bot 会话列表。
      workspace.chatRoster.reload();
      workspace.chats.reload();
    },
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(276);
  const [chatWidth, setChatWidth] = useState(620);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [savedChatWidth, setSavedChatWidth] = useState(620);
  const [previewState, setPreviewState] = useState<{
    chatIdentity: string;
    artifact: Extract<ChatTimelineItemView, { kind: "artifact" }>;
  } | null>(null);
  const chatIdentity =
    selectedChat === null
      ? ""
      : `${selectedChat.ref.connectionId}/${selectedChat.ref.agentId}/${selectedChat.ref.sessionId}`;

  const previewArtifact =
    previewState !== null && previewState.chatIdentity === chatIdentity
      ? previewState.artifact
      : null;
  const previewVisible = previewArtifact !== null && selectedChat !== null;
  const showChatPane = !(previewVisible && previewFullscreen);

  const updateChatWidth = (value: number) => {
    setChatWidth(Math.min(Math.max(value, 360), 1100));
  };

  const enterPreviewFullscreen = () => {
    setSavedChatWidth(chatWidth);
    setPreviewFullscreen(true);
  };

  const exitPreviewFullscreen = () => {
    setPreviewFullscreen(false);
    setChatWidth(savedChatWidth);
  };

  const closePreview = () => {
    setPreviewState(null);
    setPreviewFullscreen(false);
    setChatWidth(savedChatWidth);
  };

  return (
    <main
      className={cn(
        "min-h-screen bg-surface",
        workspace.showConnectionManager && "app-shell--onboarding",
      )}
    >
      {workspace.showConnectionManager ? (
        <ConnectionsGate
          version={workspace.version}
          mode={workspace.needsConnection ? "onboarding" : "settings"}
          connectionsApi={workspace.connectionsApi}
          activeConnectionId={workspace.activeConnection?.id ?? null}
          onBack={workspace.closeConnections}
          onConnected={(connectionId) => {
            if (connectionId) workspace.selectConnection(connectionId);
            if (connectionId || workspace.needsConnection) workspace.closeConnections();
          }}
        />
      ) : (
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <div className="relative flex h-screen min-h-[560px] overflow-hidden bg-background max-md:block">
            <>
              <div className="relative h-screen shrink-0 max-md:hidden" style={{ width: sidebarWidth }}>
                <AppSidebar
                  connectedConnections={workspace.connectedConnections}
                  incompleteConnectionCount={workspace.incompleteConnectionCount}
                  selectedConnectionId={workspace.selectedConnectionId}
                  area={workspace.location.area}
                  selectedBot={selectedBot}
                  justCreatedBot={
                    workspace.location.area === "bots" &&
                    workspace.location.page === "detail" &&
                    workspace.location.justCreated === true
                  }
                  selectedChat={selectedChat}
                  allChatsSelected={
                    workspace.location.area === "chats" && workspace.location.page === "overview"
                  }
                  activeConnection={workspace.activeConnection}
                  activeProviderName={workspace.activeProviderName}
                  bots={workspace.bots.bots}
                  botsLoading={workspace.bots.loading}
                  chatRoster={workspace.chatRoster}
                  searchQuery={workspace.searchQuery}
                  archiving={workspace.chatArchive.archiving}
                  deleting={workspace.chatDelete.deleting}
                  onSearchQueryChange={workspace.setSearchQuery}
                  onAreaChange={(area) =>
                    area === "chats"
                      ? workspace.openTaskHome()
                      : area === "deployments"
                        ? workspace.openDeployments()
                        : workspace.openBotList()
                  }
                  onSelectConnection={workspace.selectConnection}
                  onOpenChat={workspace.openChat}
                  onOpenBot={workspace.openBotChats}
                  onEditBot={(bot) => workspace.openBotEditor(bot.ref)}
                  onSetChatShared={workspace.setChatShared}
                  onArchiveChat={workspace.archiveChat}
                  onDeleteChat={workspace.deleteChat}
                  onCreateChat={workspace.startTaskWithBot}
                  onOpenBotList={workspace.openBotList}
                  onOpenTeamTemplates={workspace.openTeamTemplates}
                  onOpenNewChat={workspace.openNewChat}
                  onOpenAllChats={workspace.openChatsOverview}
                  onCreateBot={workspace.openBotCreation}
                  onOpenDeployments={workspace.openDeployments}
                  onOpenConnections={workspace.openConnections}
                />
                <WorkspaceResizer
                  className="absolute inset-y-0 right-0 z-10 translate-x-1/2 max-md:hidden"
                  label="调整导航区宽度"
                  value={sidebarWidth}
                  min={220}
                  max={440}
                  onChange={setSidebarWidth}
                />
              </div>
            </>

            <section
              className={cn(
                "flex h-screen min-w-0 flex-col overflow-hidden bg-surface-raised",
                previewVisible && showChatPane ? "shrink" : "flex-1",
                !showChatPane && "hidden",
              )}
              style={previewVisible && showChatPane ? { width: chatWidth } : undefined}
            >
              <WorkspaceHeader
                activeConnection={workspace.activeConnection}
                activeProviderName={workspace.activeProviderName}
                onOpenBotList={workspace.openTaskHome}
                onOpenNewChat={workspace.openNewChat}
                onOpenConnections={workspace.openConnections}
              />
              <div className="min-h-0 flex-1 overflow-hidden">
                {workspace.activeConnection !== null ? (
                  workspace.location.area === "chats" && workspace.location.page === "new" ? (
                    <NewTaskPage
                      bots={workspace.bots.bots}
                      roster={workspace.chatRoster.items}
                      loading={workspace.bots.loading}
                      botsError={workspace.bots.error}
                      selectedBotUnavailable={workspace.taskBotUnavailable}
                      onReloadBots={workspace.bots.reload}
                      draft={workspace.taskDraft}
                      selectedBot={workspace.taskBot}
                      connectionId={workspace.activeConnection.id}
                      provider={workspace.activeConnection.provider}
                      creating={workspace.creatingChat}
                      error={workspace.createError}
                      onDraftChange={workspace.setTaskDraft}
                      onSelectBot={workspace.setTaskBot}
                      onClearBot={() => workspace.setTaskBot(null)}
                      onCreateBot={workspace.openBotCreation}
                      onSend={workspace.sendNewTask}
                    />
                  ) : workspace.location.area === "bots" && workspace.editingBotRef !== null ? (
                    <BotSettingsForm
                      botRef={workspace.editingBotRef}
                      bots={workspace.bots.bots}
                      botsLoading={workspace.bots.loading}
                      botsError={workspace.bots.error}
                      onReloadBots={workspace.bots.reload}
                      onSave={workspace.bots.save}
                      onSaved={() => {
                        workspace.closeBotEditor();
                      }}
                      onCancel={workspace.closeBotEditor}
                    />
                  ) : workspace.location.area === "bots" &&
                    workspace.location.page === "templates" ? (
                    <TeamTemplateCreation
                      bots={workspace.bots.bots}
                      loading={workspace.bots.loading}
                      error={workspace.bots.error}
                      provider={workspace.activeConnection.provider}
                      onCreate={workspace.bots.create}
                      onReload={workspace.bots.reload}
                      onCreated={workspace.openCreatedBot}
                      onCancel={workspace.openBotList}
                    />
                  ) : workspace.location.area === "deployments" ? (
                    <DeploymentsPage
                      connectionId={workspace.activeConnection.id}
                      provider={workspace.activeConnection.provider}
                      bots={workspace.bots.bots}
                      botsLoading={workspace.bots.loading}
                      reloadEpoch={workspace.deploymentsEpoch}
                      onOpenChat={(bot, chat) => {
                        workspace.openChat(bot, chat);
                        // Run 关联会话可能还没进侧栏/roster，立即刷新而不是等下一轮轮询。
                        workspace.chatRoster.reload();
                        workspace.chats.reload();
                      }}
                    />
                  ) : workspace.location.area === "bots" && selectedBot === null ? (
                    <BotsPage
                      connectionId={workspace.activeConnection.id}
                      bots={workspace.bots.bots}
                      loading={workspace.bots.loading}
                      error={workspace.bots.error}
                      provider={workspace.activeConnection?.provider}
                      onReload={workspace.bots.reload}
                      onSave={workspace.bots.save}
                      onCreate={workspace.bots.create}
                      onArchive={workspace.bots.archive}
                      onSetShared={workspace.bots.setShared}
                      createRequestKey={workspace.createBotRequest}
                      onCreated={workspace.openCreatedBot}
                      onCreateCancelled={workspace.cancelBotCreation}
                      onOpenChats={workspace.openBotChats}
                      onEditBot={workspace.openBotEditor}
                    />
                  ) : workspace.location.area === "bots" && selectedBot !== null ? (
                    <ChatsPage
                      botName={selectedBot.name}
                      bot={selectedBot}
                      bots={workspace.bots.bots}
                      justCreated={
                        workspace.location.area === "bots" &&
                        workspace.location.page === "detail" &&
                        workspace.location.justCreated === true
                      }
                      botRef={selectedBot.ref}
                      provider={workspace.activeConnection?.provider}
                      chats={workspace.chats.chats}
                      loading={workspace.chats.loading}
                      error={workspace.chats.error}
                      creating={workspace.creatingChat}
                      createError={workspace.createError}
                      archiving={workspace.chatArchive.archiving}
                      archiveError={workspace.chatArchive.error}
                      deleting={workspace.chatDelete.deleting}
                      deleteError={workspace.chatDelete.error}
                      botsLoading={workspace.bots.loading}
                      botsError={workspace.bots.error}
                      deploymentsEpoch={workspace.deploymentsEpoch}
                      onReload={() => { workspace.bots.reload(); workspace.chats.reload(); }}
                      onOpenChat={(chat) => workspace.openChat(selectedBot, chat)}
                      onCreateChat={() => workspace.startTaskWithBot(selectedBot)}
                      onCompleteSetup={() => workspace.openBotEditor(selectedBot.ref)}
                      onArchiveChat={workspace.archiveChat}
                      onDeleteChat={workspace.deleteChat}
                      onEditBot={
                        selectedBot.management !== "state-missing"
                          ? () => workspace.openBotEditor(selectedBot.ref)
                          : undefined
                      }
                      onSetShared={(shared) => workspace.bots.setShared(selectedBot.ref, shared)}
                      onBack={workspace.backToBots}
                      onOpenBot={workspace.openBotChats}
                    />
                  ) : selectedBot !== null && selectedChat !== null ? (
                    <ChatDetailPage
                      key={`${selectedChat.ref.connectionId}/${selectedChat.ref.agentId}/${selectedChat.ref.sessionId}`}
                      botName={selectedBot.name}
                      botRef={selectedBot.ref}
                      bots={workspace.bots.bots}
                      provider={workspace.activeConnection?.provider}
                      detail={workspace.chatDetail.detail}
                      loading={workspace.chatDetail.loading}
                      error={workspace.chatDetail.error}
                      sending={workspace.chatSend.sending}
                      streamingText={
                        workspace.chatSend.streamingText || workspace.chatWatch.streamingText
                      }
                      liveEvents={
                        workspace.chatSend.liveEvents.length > 0
                          ? workspace.chatSend.liveEvents
                          : workspace.chatWatch.liveEvents
                      }
                      sendError={workspace.chatSend.error}
                      archiving={workspace.chatArchive.archiving}
                      archiveError={workspace.chatArchive.error}
                      deleting={workspace.chatDelete.deleting}
                      deleteError={workspace.chatDelete.error}
                      onSend={(text, attachments) =>
                        workspace.chatSend.send(text, attachments)
                      }
                      onReload={workspace.chatDetail.reload}
                      onArchiveChat={() => void workspace.archiveChat(selectedChat)}
                      onDeleteChat={() => void workspace.deleteChat(selectedChat)}
                      onEditBot={
                        selectedBot.management !== "state-missing"
                          ? () => workspace.openBotEditor(selectedBot.ref)
                          : undefined
                      }
                      onOpenBot={workspace.openBotChats}
                      onBack={workspace.closeChat}
                      initialDraft={
                        workspace.firstMessageDraft?.chatKey === chatKey(selectedChat.ref)
                          ? workspace.firstMessageDraft.text
                          : undefined
                      }
                      onOpenArtifact={(artifact) => {
                        setPreviewState({ chatIdentity, artifact });
                        setPreviewFullscreen(false);
                        setSavedChatWidth(chatWidth < 360 ? 620 : chatWidth);
                        setChatWidth((value) => (value < 360 ? 620 : value));
                      }}
                    />
                  ) : (
                    <ChatsOverviewPage
                      bots={workspace.bots.bots}
                      provider={workspace.activeConnection?.provider}
                      roster={workspace.chatRoster}
                      archiving={workspace.chatArchive.archiving}
                      deleting={workspace.chatDelete.deleting}
                      archiveError={workspace.chatArchive.error}
                      deleteError={workspace.chatDelete.error}
                      onOpenNewChat={workspace.openNewChat}
                      onOpenChat={workspace.openChat}
                      onEditBot={(bot) => workspace.openBotEditor(bot.ref)}
                      onArchiveChat={workspace.archiveChat}
                      onDeleteChat={workspace.deleteChat}
                    />
                  )
                ) : null}
              </div>
            </section>

            {previewVisible && selectedChat !== null ? (
              <>
                {!previewFullscreen ? (
                  <WorkspaceResizer
                    className="max-md:hidden"
                    label="调整聊天与预览区宽度"
                    value={chatWidth}
                    min={360}
                    max={1100}
                    onChange={updateChatWidth}
                    onDrag={(clientX) => {
                      if (clientX <= sidebarWidth + 180) enterPreviewFullscreen();
                    }}
                  />
                ) : null}
                <ArtifactWorkspace
                  artifact={previewArtifact}
                  chatRef={selectedChat.ref}
                  open
                  onClose={closePreview}
                  layout="inline"
                  fullscreen={previewFullscreen}
                  onToggleFullscreen={() =>
                    previewFullscreen ? exitPreviewFullscreen() : enterPreviewFullscreen()
                  }
                />
              </>
            ) : null}

            <MobileChatNavigation
              connectedConnections={workspace.connectedConnections}
              incompleteConnectionCount={workspace.incompleteConnectionCount}
              selectedConnectionId={workspace.selectedConnectionId}
              area={workspace.location.area}
              selectedBot={selectedBot}
              justCreatedBot={
                workspace.location.area === "bots" &&
                workspace.location.page === "detail" &&
                workspace.location.justCreated === true
              }
              selectedChat={selectedChat}
              allChatsSelected={
                workspace.location.area === "chats" && workspace.location.page === "overview"
              }
              activeConnection={workspace.activeConnection}
              activeProviderName={workspace.activeProviderName}
              bots={workspace.bots.bots}
              botsLoading={workspace.bots.loading}
              chatRoster={workspace.chatRoster}
              searchQuery={workspace.searchQuery}
              archiving={workspace.chatArchive.archiving}
              deleting={workspace.chatDelete.deleting}
              onClose={() => setMobileNavOpen(false)}
              onSearchQueryChange={workspace.setSearchQuery}
              onAreaChange={(area) =>
                area === "chats"
                  ? workspace.openTaskHome()
                  : area === "deployments"
                    ? workspace.openDeployments()
                    : workspace.openBotList()
              }
              onSelectConnection={workspace.selectConnection}
              onOpenChat={workspace.openChat}
              onOpenBot={workspace.openBotChats}
              onEditBot={(bot) => workspace.openBotEditor(bot.ref)}
              onSetChatShared={workspace.setChatShared}
              onArchiveChat={workspace.archiveChat}
              onDeleteChat={workspace.deleteChat}
              onCreateChat={workspace.startTaskWithBot}
              onOpenAllChats={workspace.openChatsOverview}
              onCreateBot={workspace.openBotCreation}
              onOpenTeamTemplates={workspace.openTeamTemplates}
              onOpenDeployments={workspace.openDeployments}
              onOpenConnections={workspace.openConnections}
            />
          </div>
        </Sheet>
      )}
    </main>
  );
}
