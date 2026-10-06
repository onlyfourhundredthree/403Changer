#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Peer Connection - Legacy compatibility module.
Party mode now uses shared relay rooms instead of per-peer connections.
This module kept for imports used by other modules.
"""

from enum import Enum
from typing import Optional

from ..protocol.message_types import SkinSelection


class ConnectionState(Enum):
    """Peer connection state"""
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    HANDSHAKING = "handshaking"
    CONNECTED = "connected"
    DEAD = "dead"


class PeerConnection:
    """Legacy stub — party mode now uses PartyRelay shared rooms."""

    def __init__(self, **kwargs):
        self.peer_info = type('PeerInfo', (), {
            'summoner_id': 0,
            'summoner_name': 'Unknown',
            'skin_selection': None,
            'in_lobby': False,
        })()
        self.state = ConnectionState.DISCONNECTED

    @property
    def summoner_id(self) -> int:
        return self.peer_info.summoner_id

    @property
    def summoner_name(self) -> str:
        return self.peer_info.summoner_name

    @property
    def is_connected(self) -> bool:
        return self.state == ConnectionState.CONNECTED

    @property
    def skin_selection(self) -> Optional[SkinSelection]:
        return self.peer_info.skin_selection
