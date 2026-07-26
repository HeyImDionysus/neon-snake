import roomCore from "../server/room-core.cjs";

export const config = {
  maxDuration: 10,
};

export default roomCore.createRoomHandler();
